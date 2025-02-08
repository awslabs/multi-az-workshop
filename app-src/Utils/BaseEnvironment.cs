using System;
using System.IO;
using Microsoft.Extensions.Logging;

namespace BAMCIS.MultiAZApp.Utils
{
    public abstract class BaseEnvironment : IEnvironment
    {
        private static string _region;
        private static string _az;
        private static string _azid;
        private static string _instanceid;
        private static bool _onebox;

        internal static string _hostid;
        internal static ILogger _logger;
        internal static IResourceFetcher _fetcher;

        public BaseEnvironment(ILogger logger, IResourceFetcher fetcher) 
        {
            _logger = logger;
            _fetcher = fetcher;
        }

        static BaseEnvironment()
        {
            _region = Amazon.Util.EC2InstanceMetadata.Region != null ? Amazon.Util.EC2InstanceMetadata.Region.SystemName : String.Empty;
            _az = !String.IsNullOrEmpty(Amazon.Util.EC2InstanceMetadata.GetData("/placement/availability-zone")) ? Amazon.Util.EC2InstanceMetadata.GetData("/placement/availability-zone") : String.Empty;
            _azid = !String.IsNullOrEmpty(Amazon.Util.EC2InstanceMetadata.GetData("/placement/availability-zone-id")) ? Amazon.Util.EC2InstanceMetadata.GetData("/placement/availability-zone-id") : String.Empty;
            _instanceid = !String.IsNullOrEmpty(Amazon.Util.EC2InstanceMetadata.InstanceId) ? Amazon.Util.EC2InstanceMetadata.InstanceId : String.Empty;
            GetOneBoxData();
        }

        public string GetRegion()
        {
            if (String.IsNullOrEmpty(_region))
            {
                _region = Amazon.Util.EC2InstanceMetadata.Region != null ? Amazon.Util.EC2InstanceMetadata.Region.SystemName : String.Empty;
            }

            return !String.IsNullOrEmpty(_region) ? _region : "unknown";
        }

        public string GetAZ()
        {
            if (String.IsNullOrEmpty(_az))
            {
                _az = !String.IsNullOrEmpty(Amazon.Util.EC2InstanceMetadata.AvailabilityZone) ? Amazon.Util.EC2InstanceMetadata.AvailabilityZone : String.Empty;
            }

            return !String.IsNullOrEmpty(_az) ? _az : "unknown";
        }

        public string GetAZId()
        {
            if (String.IsNullOrEmpty(_azid))
            {
                _azid = !String.IsNullOrEmpty(Amazon.Util.EC2InstanceMetadata.GetData("/placement/availability-zone-id")) ? Amazon.Util.EC2InstanceMetadata.GetData("/placement/availability-zone-id") : String.Empty;
            }
            
            return !String.IsNullOrEmpty(_azid) ? _azid : "unknown";
        }

        public string GetInstanceId() 
        {
            if (String.IsNullOrEmpty(_instanceid))
            {
                _instanceid = !String.IsNullOrEmpty(Amazon.Util.EC2InstanceMetadata.InstanceId) ? Amazon.Util.EC2InstanceMetadata.InstanceId : String.Empty;
            }

            return !String.IsNullOrEmpty(_instanceid) ? _instanceid : "unknown";
        }

        private static void GetOneBoxData()
        {
            _onebox = false;

            string onebox = System.Environment.GetEnvironmentVariable("ONEBOX");

            bool empty = String.IsNullOrEmpty(onebox);

            try
            {
                // if it's empty or it's not empty and parsing failes AND the files exists, use the file
                // otherwise it wasn't empty and parsing succeeded
                if (((!empty && !Boolean.TryParse(onebox, out _onebox)) || empty) && File.Exists("/etc/onebox"))
                {
                    string text = File.ReadAllText("/etc/onebox");
                    string[] parts = text.Split("=");

                    if (parts[0] == "ONEBOX")
                    {
                        Boolean.TryParse(parts[1], out _onebox);
                    }
                } // don't need to do anything else, if it wasn't empty, we tried parsing, and if parsing
                  // didn't work, then we read the file, if available
            }
            catch (Exception) { }
        }

        public bool IsOneBox()
        {
            return _onebox;
        }

        public abstract string GetHostId();

        public abstract bool Probe();

        public abstract Environment GetEnvironmentType();
    }
}