using Microsoft.Extensions.Logging;

namespace BAMCIS.MultiAZApp.Utilities
{
    public class DefaultEnvironment : IEnvironment
    {
        private static ILogger _logger;
        private static IResourceFetcher _fetcher;

        public DefaultEnvironment(ILogger logger) : this(logger, new ResourceFetcher())
        {

        }

        public DefaultEnvironment(ILogger logger, IResourceFetcher fetcher)
        {
            _logger = logger;
            _fetcher = fetcher;
        }

        public string GetHostId()
        {
            return "localhost";
        }

        public bool Probe()
        {
            return true;
        }

        public Environment GetEnvironmentType()
        {
            return Environment.LOCAL;
        }

        public string GetInstanceId()
        {
            return "localhost";
        }

        public string GetRegion()
        {
            return "localhost";
        }

        public string GetAZId()
        {
            return "localhost";
        }

        public string GetAZ()
        {
            return "localhost";
        }

        public bool IsOneBox()
        {
            return false;
        }
    }
}