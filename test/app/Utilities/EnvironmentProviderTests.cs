using Xunit;
using Moq;
using Microsoft.Extensions.Logging;
using BAMCIS.MultiAZApp.Utilities;
using AppEnvironment = BAMCIS.MultiAZApp.Utilities.Environment;

namespace BAMCIS.MultiAZApp.Tests.Utilities
{
    public class EnvironmentProviderTests
    {
        private readonly Mock<ILoggerFactory> _mockLoggerFactory;
        private readonly Mock<ILogger> _mockLogger;

        public EnvironmentProviderTests()
        {
            _mockLoggerFactory = new Mock<ILoggerFactory>();
            _mockLogger = new Mock<ILogger>();
            _mockLoggerFactory.Setup(f => f.CreateLogger(It.IsAny<string>()))
                .Returns(_mockLogger.Object);
        }

        [Fact]
        public void ResolveEnvironment_ReturnsEnvironment()
        {
            var provider = new EnvironmentProvider(_mockLoggerFactory.Object);

            var environment = provider.ResolveEnvironment();

            Assert.NotNull(environment);
        }

        [Fact]
        public void ResolveEnvironment_CachesResult()
        {
            var provider = new EnvironmentProvider(_mockLoggerFactory.Object);

            var env1 = provider.ResolveEnvironment();
            var env2 = provider.ResolveEnvironment();

            Assert.Same(env1, env2);
        }

        [Fact]
        public void ResolveEnvironment_ReturnsValidEnvironment()
        {
            var provider = new EnvironmentProvider(_mockLoggerFactory.Object);

            var environment = provider.ResolveEnvironment();

            // The environment type depends on the actual runtime environment
            // It could be LOCAL, EC2, ECS, or EKS
            var envType = environment.GetEnvironmentType();
            Assert.True(
                envType == AppEnvironment.LOCAL || 
                envType == AppEnvironment.EC2 || 
                envType == AppEnvironment.ECS || 
                envType == AppEnvironment.EKS,
                $"Expected a valid environment type, got {envType}");
        }
    }
}
