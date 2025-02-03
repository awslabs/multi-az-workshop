using System;
using Microsoft.Extensions.Logging;

namespace BAMCIS.MultiAZApp.Utils
{
    public abstract class BaseEnvironment : IEnvironment
    {
        private static string _region;
        private static string _az;
        private static string _azid;
        private static string _instanceid;

        internal static ILogger _logger;
        internal static IResourceFetcher _fetcher;

        public BaseEnvironment(ILogger logger, IResourceFetcher fetcher) 
        {
            _logger = logger;
            _fetcher = fetcher;
        }

        public string GetRegion()
        {
            if (String.IsNullOrEmpty(_region))
            {
                _region = Amazon.Util.EC2InstanceMetadata.Region != null ? Amazon.Util.EC2InstanceMetadata.Region.SystemName : String.Empty;

                if (String.IsNullOrEmpty(_region))
                {
                    return "unknown";
                }
                else
                {
                    return _region;
                }
            }
            else
            {
                return _region;
            }   
        }

        public string GetAZ()
        {
            if (String.IsNullOrEmpty(_az))
            {
                _az = !String.IsNullOrEmpty(Amazon.Util.EC2InstanceMetadata.GetData("/placement/availability-zone")) ? Amazon.Util.EC2InstanceMetadata.GetData("/placement/availability-zone") : String.Empty;

                if (String.IsNullOrEmpty(_az))
                {
                    return "unknown";
                }
                else
                {
                    return _az;
                }
            }
            else
            {
                return _az;
            }
        }

        public string GetAZId()
        {
            if (String.IsNullOrEmpty(_azid))
            {
                _azid = !String.IsNullOrEmpty(Amazon.Util.EC2InstanceMetadata.GetData("/placement/availability-zone-id")) ? Amazon.Util.EC2InstanceMetadata.GetData("/placement/availability-zone-id") : String.Empty;

                if (String.IsNullOrEmpty(_azid))
                {
                    return "unknown";
                }
                else
                {
                    return _azid;
                }
            }
            else
            {
                return _azid;
            }
        }

        public string GetInstanceId() 
        {
            if (String.IsNullOrEmpty(_instanceid))
            {
                _instanceid = !String.IsNullOrEmpty(Amazon.Util.EC2InstanceMetadata.InstanceId) ? Amazon.Util.EC2InstanceMetadata.InstanceId : String.Empty;

                if (String.IsNullOrEmpty(_instanceid))
                {
                    return "unknown";
                }
                else
                {
                    return _instanceid;
                }
            }
            else
            {
                return _instanceid;
            }
        }

        public abstract string GetHostId();

        public abstract bool Probe();

        public abstract Environment GetEnvironmentType();
    }
}