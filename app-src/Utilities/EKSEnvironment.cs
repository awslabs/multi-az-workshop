using System;
using Microsoft.Extensions.Logging;

namespace BAMCIS.MultiAZApp.Utilities
{
    public class EKSEnvironment : BaseEnvironment, IEnvironment
    {
        private static string _k8s = "KUBERNETES_SERVICE_HOST";

        private static string _hostname = "HOSTNAME";

        public EKSEnvironment(ILogger logger) : this(logger, new ResourceFetcher())
        {

        }

        public EKSEnvironment(ILogger logger, IResourceFetcher fetcher) : base(logger, fetcher)
        {
            _hostid = System.Environment.GetEnvironmentVariable(_hostname);
        }

        public override string GetHostId()
        {
            return _hostid;
        }

        public override bool Probe()
        {
            try
            {
                string k8s = System.Environment.GetEnvironmentVariable(_k8s);

                if (!String.IsNullOrEmpty(k8s)) 
                {
                    return !String.IsNullOrEmpty(_hostid);
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Failed to lookup EKS environment variables.");
            }

            return false;
        }

        public override Environment GetEnvironmentType()
        {
            return Environment.EKS;
        }
    }
}