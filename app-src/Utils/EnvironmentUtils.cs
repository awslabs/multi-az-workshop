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
        public static string onebox;

        static EnvironmentUtils()
        {
            region = GetRegionMetadata();
            azid = GetAzIdMetadata();
            az = GetAzMetadata();
            instanceid = GetInstanceIdMetadata();
            hostid = GetHostIdMetadata();
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

                if (String.IsNullOrEmpty(region))
                {
                    return "unknown";
                }
                else
                {
                    return region;
                }
            }
            else
            {
                return region;
            }       
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

                if (String.IsNullOrEmpty(azid))
                {
                    return "unknown";
                }
                else
                {
                    return azid;
                }
            }
            else
            {
                return azid;
            }
        }

        private static string GetAzMetadata()
        {
            return !String.IsNullOrEmpty(Amazon.Util.EC2InstanceMetadata.GetData("/placement/availability-zone")) ? Amazon.Util.EC2InstanceMetadata.GetData("/placement/availability-zone") : String.Empty;
        }

        public static string GetAZ()
        {
            if (String.IsNullOrEmpty(az))
            {
                az = GetAzMetadata();

                if (String.IsNullOrEmpty(az))
                {
                    return "unknown";
                }
                else
                {
                    return az;
                }
            }
            else
            {
                return az;
            }
        }

        private static string GetInstanceIdMetadata()
        {
            return !String.IsNullOrEmpty(Amazon.Util.EC2InstanceMetadata.InstanceId) ? Amazon.Util.EC2InstanceMetadata.InstanceId : String.Empty;
        }

        public static string GetInstanceId()
        {
            if (String.IsNullOrEmpty(instanceid))
            {
                instanceid = GetInstanceIdMetadata();

                if (String.IsNullOrEmpty(instanceid))
                {
                    return "unknown";
                }
                else
                {
                    return instanceid;
                }
            }
            else
            {
                return instanceid;
            }
        }

        private static string GetHostIdMetadata()
        {
            string k8s = Environment.GetEnvironmentVariable("KUBERNETES_SERVICE_HOST");
            string ecsMetadata = Environment.GetEnvironmentVariable("ECS_CONTAINER_METADATA_URI_V4");
            string hostId = "";

            if (!String.IsNullOrEmpty(k8s))
            {
                hostId = Environment.GetEnvironmentVariable("HOSTNAME");
            }
            else if (!String.IsNullOrEmpty(ecsMetadata))
            {
                using (HttpClient client = new HttpClient())
                {
                    string response = Task.Run(() => client.GetStringAsync(ecsMetadata + "/task")).Result;
                    Dictionary<string, object> data = JsonConvert.DeserializeObject<Dictionary<string, object>>(response);
                    string service = data["ServiceName"] as string;
                    string taskArn = data["TaskARN"] as string;

                    hostId = service + "-" + taskArn.Split(":").Last();
                }
            }
            else
            {
                hostId = GetInstanceIdMetadata();
            }

            return hostId;
        }

        public static string GetHostId()
        {
            if (String.IsNullOrEmpty(hostid))
            {
                hostid = GetInstanceIdMetadata();

                if (String.IsNullOrEmpty(hostid))
                {
                    return "unknown";
                }
                else
                {
                    return hostid;
                }
            }
            else
            {
                return hostid;
            }
        }

        public static bool IsOneBox()
        {
            bool isOneBox = false;

            string onebox = Environment.GetEnvironmentVariable("ONEBOX");

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
    }
}
