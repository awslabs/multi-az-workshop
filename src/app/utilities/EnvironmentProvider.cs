using System;
using Microsoft.Extensions.Logging;

namespace BAMCIS.MultiAZApp.Utilities
{
    public class EnvironmentProvider: IEnvironmentProvider
    {
        private static IEnvironment _cachedEnvironment;

        private ILoggerFactory _loggerFactory;
        private ILogger _logger;

        public EnvironmentProvider(ILoggerFactory loggerFactory)
        {
            _loggerFactory = loggerFactory;
            _logger = _loggerFactory.CreateLogger("EnvironmentProvider");
        }

        public IEnvironment ResolveEnvironment()
        {
            if (_cachedEnvironment != null) {
                return _cachedEnvironment;
            }

            IEnvironment env = GetEnvironmentByProbe();

            if (env != null) {
                _cachedEnvironment = env;
            }

            return env;
        }

        private IEnvironment GetEnvironmentByProbe()
        {
            //IEnvironment environment = new LambdaEnvironment();
            //if (environment.Probe()) return environment;

            IEnvironment environment = new ECSEnvironment(_logger);
            if (environment.Probe()) return environment;

            environment = new EKSEnvironment(_logger);
            if (environment.Probe()) return environment;

            environment = new EC2Environment(_logger);
            if (environment.Probe()) return environment;

            environment = new DefaultEnvironment(_logger);
            return environment.Probe() ? environment : null;
        }
    }
}