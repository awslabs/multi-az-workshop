using System;
using Microsoft.Extensions.Logging;

namespace BAMCIS.MultiAZApp.Utils
{
    public class EKSEnvironment : BaseEnvironment, IEnvironment
    {
        private static string _k8s = "KUBERNETES_SERVICE_HOST";

        private static string _hostname = "HOSTNAME";

        private string _host;

        public EKSEnvironment(ILogger logger) : this(logger, new ResourceFetcher())
        {

        }

        public EKSEnvironment(ILogger logger, IResourceFetcher fetcher) : base(logger, fetcher)
        {
            _host = System.Environment.GetEnvironmentVariable(_hostname);
        }

        public override string GetHostId()
        {
            return _host;
        }

        public override bool Probe()
        {
            try
            {
                string k8s = System.Environment.GetEnvironmentVariable(_k8s);

                if (!String.IsNullOrEmpty(k8s)) 
                {
                    return !String.IsNullOrEmpty(_host);
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug("Failed to lookup EKS environment variables.", ex);
            }

            return false;
        }

        public override Environment GetEnvironmentType()
        {
            return Environment.EKS;
        }
    }
}