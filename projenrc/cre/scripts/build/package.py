#!/usr/bin/env python3

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Post-process one synthesized stack's cdk.out artifacts into a flat assets/
# folder ready to sync to S3.
#
# Adapted from awslabs/multi-az-workshop/build/package.py with one delta:
# no static/ directory. We pack the top-level template into assets/ under
# its human-readable name instead.
#
# For each nested stack referenced from the current template, read the
# child's body and forward AssetsBucketName/AssetsBucketPrefix whenever the
# child (or its own children) reference them via ${AssetsBucket*}. The
# outer manifest loop visits every template, so deeper nesting composes
# naturally — no recursion needed.
#
# Per-region buckets: each stack is deployed in the same region as its
# assets bucket, so the nested-stack TemplateURL keeps the CDK-synthesized
# {Ref: AWS::Region} form. No cross-region endpoint handling here.

import os
import json
import shutil
import sys

stack_name = sys.argv[1] # The name of the stack
src_dir = sys.argv[2] # The root directory of the project

assets_bucket_variable_name = "AssetsBucketName"
assets_bucket_prefix_variable_name = "AssetsBucketPrefix"
assets_folder = os.path.join(src_dir, "assets")
cdk_out = os.path.join(src_dir, "cdk.out")
manifest = os.path.join(cdk_out, f"{stack_name}.assets.json")

if not os.path.exists(assets_folder):
    os.mkdir(assets_folder)

# Keep track of files that have been modified
modified_files = set()

f = open(manifest)
assets = json.loads(f.read())
f.close()

# First pass: Process all templates to identify and modify nested stacks
for key in assets["files"]:
    path = assets["files"][key]["source"]["path"]
    packaging = assets["files"][key]["source"]["packaging"]
    
    if packaging == "file":
        extension = path.split(".")[-1]
        
        if extension == "json" or extension == "template":
            # Read the template to check for nested stacks
            with open(os.path.join(cdk_out, path), mode = "r") as cfn_file:
                cfn_template = json.loads(cfn_file.read())

            template_modified = False

            # Look at each resource in the template
            if "Resources" in cfn_template:
                for resource in cfn_template["Resources"]:
                    # If the resource is a stack, this is a nested stack that could be using
                    # an included asset where we need to pass the assets bucket parameter
                    if cfn_template["Resources"][resource]["Type"] == "AWS::CloudFormation::Stack":
                        # Get the nested stack object key
                        url = cfn_template["Resources"][resource]["Properties"]["TemplateURL"]

                        if isinstance(url, str):
                            # https://s3.us-east-1.amazonaws.com/mybucket/myprefix/prefix2/objectkey.json
                            child_key = url.split("/")[-1].split(".")[0]
                        else:
                            # "${AssetsBucketPrefix}48c21d0f9246924ef7517d86ae542edd9558c1b16cdffb4502097e5e495bd3d8.json"
                            child_key = url["Fn::Join"][1][-1]["Fn::Sub"].replace("${" + assets_bucket_prefix_variable_name + "}", "").split(".")[0]

                        # Get the nested stack's template path
                        child_path = assets["files"][child_key]["source"]["path"]

                        # Read the child template to check if it needs modification
                        with open(os.path.join(cdk_out, child_path), mode = "r") as child_file:
                            raw_file = child_file.read()

                        # If the child references ${AssetsBucketName} anywhere —
                        # either directly or transitively via its own nested
                        # stacks (whose TemplateURLs will reference it after
                        # the outer loop processes them) — forward both vars.
                        if ("${" + assets_bucket_variable_name + "}") in raw_file:

                            print("Replacing", assets_bucket_variable_name, "and", assets_bucket_prefix_variable_name, "in", child_path)

                            # Parse and modify the child template
                            child_template = json.loads(raw_file)

                            # Add AssetsBucketName and AssetsBucketPrefix parameters to the child template
                            if "Parameters" not in child_template:
                                child_template["Parameters"] = {}

                            child_template["Parameters"][assets_bucket_variable_name] = { "Type": "String" }
                            child_template["Parameters"][assets_bucket_prefix_variable_name] = { "Type": "String" }

                            # Write the modified child template back to disk
                            with open(os.path.join(cdk_out, child_path), mode = "w") as child_file:
                                child_file.write(json.dumps(child_template, indent = 4))
                            
                            # Mark this child file as modified
                            modified_files.add(child_path)

                            # Add the assets bucket name and prefix parameters to the parent resource
                            if "Parameters" not in cfn_template["Resources"][resource]["Properties"]:
                                cfn_template["Resources"][resource]["Properties"]["Parameters"] = {}

                            cfn_template["Resources"][resource]["Properties"]["Parameters"][assets_bucket_variable_name] = { "Ref": assets_bucket_variable_name}
                            cfn_template["Resources"][resource]["Properties"]["Parameters"][assets_bucket_prefix_variable_name] = { "Ref": assets_bucket_prefix_variable_name}
                            template_modified = True

            # Write the modified main template back to disk if it was changed
            if template_modified:
                with open(os.path.join(cdk_out, path), mode = "w") as cfn_file:
                    cfn_file.write(json.dumps(cfn_template, indent = 4))

# Second pass: Copy all files to assets folder
for key in assets["files"]:
    path = assets["files"][key]["source"]["path"]
    packaging = assets["files"][key]["source"]["packaging"]
    
    if packaging == "file":
        extension = path.split(".")[-1]
        # Copy the file (now all modifications are complete)
        shutil.copy2(os.path.join(cdk_out, path), os.path.join(assets_folder, f"{key}.{extension}"))
    elif packaging == "zip":
        shutil.make_archive(os.path.join(assets_folder, key), "zip", os.path.join(cdk_out, path))

# The top-level template is deployed by its human-readable name (the deploy
# script points --template-url at s3://.../<stack_name>.json), not by hash,
# so copy it into assets/ under the stack name too.
shutil.copy2(
    os.path.join(cdk_out, f"{stack_name}.template.json"),
    os.path.join(assets_folder, f"{stack_name}.json"),
)
