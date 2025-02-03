using Microsoft.Extensions.Logging;

namespace BAMCIS.MultiAZApp.Utils
{
    public class DefaultEnvironment : BaseEnvironment
    {
        public DefaultEnvironment(ILogger logger) : this(logger, new ResourceFetcher())
        {

        }

        public DefaultEnvironment(ILogger logger, IResourceFetcher fetcher) : base (logger, fetcher)
        {

        }

        public override string GetHostId()
        {
            return "localhost";
        }

        public override bool Probe()
        {
            return true;
        }

        public override Environment GetEnvironmentType()
        {
            return Environment.LOCAL;
        }
    }
}