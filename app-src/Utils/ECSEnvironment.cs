using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Extensions.Logging;

namespace BAMCIS.MultiAZApp.Utils
{
    public class ECSEnvironment : BaseEnvironment, IEnvironment
    {
        private string _host;

        public ECSEnvironment(ILogger logger) : this(logger, new ResourceFetcher())
        {

        }

        public ECSEnvironment(ILogger logger, IResourceFetcher fetcher) : base(logger, fetcher)
        {
            string ecsMetadata = System.Environment.GetEnvironmentVariable("ECS_CONTAINER_METADATA_URI_V4");
        
            if (!String.IsNullOrEmpty(ecsMetadata))
            {
                try
                {
                    Dictionary<string, object> data = _fetcher.FetchJson<Dictionary<string, object>>(new Uri(ecsMetadata + "/task"), "GET");

                    string service = data["ServiceName"] as string;
                    // :task/1dc5c17a-422b-4dc4-b493-371970c6c4d6
                    string taskArn = data["TaskARN"] as string;

                    _host = service + "-" + taskArn.Split(":").Last().Split("/").Last();
                }
                catch (Exception ex)
                {
                    _logger.LogDebug("Failed to get metadata from: " + ecsMetadata + "/task", ex);
                }
            }
        }

        public override string GetHostId()
        {
            return _host;
        }

        public override bool Probe()
        {
            try
            {
                string ecsMetadata = System.Environment.GetEnvironmentVariable("ECS_CONTAINER_METADATA_URI_V4");

                if (!String.IsNullOrEmpty(ecsMetadata)) 
                {
                    return !String.IsNullOrEmpty(_host);
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug("Failed to lookup ECS environment variables.", ex);
            }

            return false;
        }

        public override Environment GetEnvironmentType()
        {
            return Environment.ECS;
        }
    }
}