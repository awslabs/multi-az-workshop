// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;

namespace BAMCIS.MultiAZApp.Utils
{
    public static class EnvironmentUtils
    {
        public static string region;
        public static string az;
        public static string azid;
        public static string instanceid;
        public static string hostid;
        public static bool onebox;

        static EnvironmentUtils()
        {
            region = GetRegionMetadata();
            azid = GetAzIdMetadata();
            az = GetAzMetadata();
            instanceid = GetInstanceIdMetadata();
            hostid = GetHostIdMetadata();
            onebox = GetOneBoxMetadata();
        }

        private static string GetRegionMetadata()
        {
            return Amazon.Util.EC2InstanceMetadata.Region != null ? Amazon.Util.EC2InstanceMetadata.Region.SystemName : String.Empty;
        }

        public static string GetRegion()
        {
            if (String.IsNullOrEmpty(region))
            {
                region = GetRegionMetadata();
            }

            return !String.IsNullOrEmpty(region) ? region : "unknown";
        }

        private static string GetAzIdMetadata()
        {
            return !String.IsNullOrEmpty(Amazon.Util.EC2InstanceMetadata.GetData("/placement/availability-zone-id")) ? Amazon.Util.EC2InstanceMetadata.GetData("/placement/availability-zone-id") : String.Empty;
        }

        public static string GetAZId()
        {
            if (String.IsNullOrEmpty(azid))
            {
                azid = GetAzIdMetadata();
            }

            return !String.IsNullOrEmpty(azid) ? azid : "unknown";
        }

        private static string GetAzMetadata()
        {
            return !String.IsNullOrEmpty(Amazon.Util.EC2InstanceMetadata.AvailabilityZone) ? Amazon.Util.EC2InstanceMetadata.AvailabilityZone : String.Empty;
        }

        public static string GetAZ()
        {
            if (String.IsNullOrEmpty(az))
            {
                az = GetAzMetadata();
            }

            return !String.IsNullOrEmpty(az) ? az : "unknown";
        }

        private static string GetInstanceIdMetadata()
        {
            return !String.IsNullOrEmpty(Amazon.Util.EC2InstanceMetadata.InstanceId) ? Amazon.Util.EC2InstanceMetadata.InstanceId : String.Empty;
        }

        /// <summary>
        /// Returns the underlying EC2 instance Id from the EC2 metadata service. This could be the container host id or the EC2 instance where
        /// the application is running.
        /// </summary>
        /// <returns></returns>
        public static string GetInstanceId()
        {
            if (String.IsNullOrEmpty(instanceid))
            {
                instanceid = GetInstanceIdMetadata();
            }
                
            return !String.IsNullOrEmpty(instanceid) ? instanceid : "unknown";
        }

        /// <summary>
        /// Gets the id of the container or EC2 instance. For a EKS pod, this will return the HOSTNAME environment variable, which is the pod name. For an ECS
        /// task, this will be the service name and the task unique id, like myservice-123456789012abcd. For EC2, it is the instance id.
        /// </summary>
        /// <returns></returns>
        private static string GetHostIdMetadata()
        {
            string hostId = "";

            string k8s = System.Environment.GetEnvironmentVariable("KUBERNETES_SERVICE_HOST");
            string ecsMetadata = System.Environment.GetEnvironmentVariable("ECS_CONTAINER_METADATA_URI_V4");
            if (!String.IsNullOrEmpty(k8s))
            {
                hostId = System.Environment.GetEnvironmentVariable("HOSTNAME");
            }
            else if (!String.IsNullOrEmpty(ecsMetadata))
            {
                using (HttpClient client = new HttpClient())
                {
                    string response = Task.Run(() => client.GetStringAsync(ecsMetadata + "/task")).Result;
                    Dictionary<string, object> data = JsonConvert.DeserializeObject<Dictionary<string, object>>(response);
                    string service = data["ServiceName"] as string;
                    // :task/1dc5c17a-422b-4dc4-b493-371970c6c4d6
                    string taskArn = data["TaskARN"] as string;
                    hostId = service + "-" + taskArn.Split(":").Last().Split("/").Last();
                }
            }
            else
            {
                hostId = GetInstanceIdMetadata();
            }
            
            return hostId;
        }

        /// <summary>
        /// Gets the id of the container or EC2 instance. For a EKS pod, this will return the HOSTNAME environment variable, which is the pod name. For an ECS
        /// task, this will be the service name and the task unique id, like myservice-123456789012abcd. For EC2, it is the instance id.
        /// </summary>
        /// <returns></returns>
        public static string GetHostId()
        {
            if (String.IsNullOrEmpty(hostid))
            {
                hostid = GetHostIdMetadata();
            }

            return !String.IsNullOrEmpty(hostid) ? hostid : "unknown";

        }

        private static bool GetOneBoxMetadata()
        {
            bool isOneBox = false;

            string onebox = System.Environment.GetEnvironmentVariable("ONEBOX");

            bool empty = String.IsNullOrEmpty(onebox);

            try
            {
                // if it's empty or it's not empty and parsing failes AND the files exists, use the file
                // otherwise it wasn't empty and parsing succeeded
                if (((!empty && !Boolean.TryParse(onebox, out isOneBox)) || empty) && File.Exists("/etc/onebox"))
                {
                    string text = File.ReadAllText("/etc/onebox");
                    string[] parts = text.Split("=");

                    if (parts[0] == "ONEBOX")
                    {
                        Boolean.TryParse(parts[1], out isOneBox);
                    }
                } // don't need to do anything else, if it wasn't empty, we tried parsing, and if parsing
                  // didn't work, then we read the file, if available
            }
            catch (Exception) { }

            return isOneBox;
        }

        public static bool IsOneBox()
        {
            return onebox;
        }
    }
}
