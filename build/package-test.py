#!/usr/bin/env python3

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Packages the EKS V2 test stack synthesized output for S3-based CloudFormation deployment.
Reuses the same logic as package.py but operates on cdk.out.test.
"""

import os
import json
import shutil
import sys

stack_name = sys.argv[1]  # The name of the stack
src_dir = sys.argv[2]     # The root directory of the project

assets_bucket_variable_name = "AssetsBucketName"
assets_bucket_prefix_variable_name = "AssetsBucketPrefix"
output_folder = os.path.join(src_dir, "cdk.out.test", "packaged")
cdk_out = os.path.join(src_dir, "cdk.out.test")
manifest = os.path.join(cdk_out, f"{stack_name}.assets.json")

if os.path.exists(output_folder):
    shutil.rmtree(output_folder)
os.mkdir(output_folder)

modified_files = set()

with open(manifest) as f:
    assets = json.loads(f.read())

# First pass: Process all templates to identify and modify nested stacks
for key in assets["files"]:
    path = assets["files"][key]["source"]["path"]
    packaging = assets["files"][key]["source"]["packaging"]

    if packaging == "file":
        extension = path.split(".")[-1]

        if extension == "json" or extension == "template":
            with open(os.path.join(cdk_out, path), mode="r") as cfn_file:
                cfn_template = json.loads(cfn_file.read())

            template_modified = False

            if "Resources" in cfn_template:
                for resource in cfn_template["Resources"]:
                    if cfn_template["Resources"][resource]["Type"] == "AWS::CloudFormation::Stack":
                        url = cfn_template["Resources"][resource]["Properties"]["TemplateURL"]

                        if url is str:
                            child_key = url.split("/")[-1].split(".")[0]
                        else:
                            child_key = url["Fn::Join"][1][-1]["Fn::Sub"].replace(
                                "${" + assets_bucket_prefix_variable_name + "}", ""
                            ).split(".")[0]

                        child_path = assets["files"][child_key]["source"]["path"]

                        with open(os.path.join(cdk_out, child_path), mode="r") as child_file:
                            raw_file = child_file.read()

                        if ("${" + assets_bucket_variable_name + "}") in raw_file:
                            print("FOUND A MATCH IN " + child_path)

                            child_template = json.loads(raw_file)

                            if "Parameters" not in child_template:
                                child_template["Parameters"] = {}

                            child_template["Parameters"][assets_bucket_variable_name] = {"Type": "String"}
                            child_template["Parameters"][assets_bucket_prefix_variable_name] = {"Type": "String"}

                            with open(os.path.join(cdk_out, child_path), mode="w") as child_file:
                                child_file.write(json.dumps(child_template, indent=4))

                            modified_files.add(child_path)

                            if "Parameters" not in cfn_template["Resources"][resource]["Properties"]:
                                cfn_template["Resources"][resource]["Properties"]["Parameters"] = {}

                            cfn_template["Resources"][resource]["Properties"]["Parameters"][assets_bucket_variable_name] = {"Ref": assets_bucket_variable_name}
                            cfn_template["Resources"][resource]["Properties"]["Parameters"][assets_bucket_prefix_variable_name] = {"Ref": assets_bucket_prefix_variable_name}
                            template_modified = True

            if template_modified:
                with open(os.path.join(cdk_out, path), mode="w") as cfn_file:
                    cfn_file.write(json.dumps(cfn_template, indent=4))

# Second pass: Copy all files to output folder
for key in assets["files"]:
    path = assets["files"][key]["source"]["path"]
    packaging = assets["files"][key]["source"]["packaging"]

    if packaging == "file":
        extension = path.split(".")[-1]
        shutil.copy2(os.path.join(cdk_out, path), os.path.join(output_folder, f"{key}.{extension}"))
    elif packaging == "zip":
        shutil.make_archive(os.path.join(output_folder, key), "zip", os.path.join(cdk_out, path))

# Copy the main template with a known name
shutil.copy2(
    os.path.join(cdk_out, f"{stack_name}.template.json"),
    os.path.join(output_folder, f"{stack_name}.json"),
)

print(f"Packaged {len(assets['files'])} assets to {output_folder}")
