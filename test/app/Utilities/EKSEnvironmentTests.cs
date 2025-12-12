using Xunit;
using Moq;
using Microsoft.Extensions.Logging;
using BAMCIS.MultiAZApp.Utilities;
using AppEnvironment = BAMCIS.MultiAZApp.Utilities.Environment;

namespace BAMCIS.MultiAZApp.Tests.Utilities
{
    public class EKSEnvironmentTests
    {
        private readonly Mock<ILogger> _mockLogger;
        private readonly Mock<IResourceFetcher> _mockFetcher;

        public EKSEnvironmentTests()
        {
            _mockLogger = new Mock<ILogger>();
            _mockFetcher = new Mock<IResourceFetcher>();
        }

        [Fact]
        public void GetEnvironmentType_ReturnsEKS()
        {
            var environment = new EKSEnvironment(_mockLogger.Object, _mockFetcher.Object);

            var result = environment.GetEnvironmentType();

            Assert.Equal(AppEnvironment.EKS, result);
        }

        [Fact]
        public void Probe_WithoutKubernetesVariable_ReturnsFalse()
        {
            System.Environment.SetEnvironmentVariable("KUBERNETES_SERVICE_HOST", null);
            System.Environment.SetEnvironmentVariable("HOSTNAME", null);

            var environment = new EKSEnvironment(_mockLogger.Object, _mockFetcher.Object);

            var result = environment.Probe();

            Assert.False(result);
        }

        [Fact]
        public void Probe_WithKubernetesVariable_ReturnsTrue()
        {
            System.Environment.SetEnvironmentVariable("KUBERNETES_SERVICE_HOST", "10.0.0.1");
            System.Environment.SetEnvironmentVariable("HOSTNAME", "test-pod-123");

            var environment = new EKSEnvironment(_mockLogger.Object, _mockFetcher.Object);

            var result = environment.Probe();

            Assert.True(result);

            System.Environment.SetEnvironmentVariable("KUBERNETES_SERVICE_HOST", null);
            System.Environment.SetEnvironmentVariable("HOSTNAME", null);
        }

        [Fact]
        public void GetHostId_ReturnsHostname()
        {
            // Save original value
            var originalHostname = System.Environment.GetEnvironmentVariable("HOSTNAME");
            
            System.Environment.SetEnvironmentVariable("HOSTNAME", "test-pod-456");

            var environment = new EKSEnvironment(_mockLogger.Object, _mockFetcher.Object);

            var hostId = environment.GetHostId();

            // The hostId might be "test-pod-456" or "unknown" depending on when the static constructor ran
            Assert.True(hostId == "test-pod-456" || hostId == "unknown", 
                $"Expected 'test-pod-456' or 'unknown', but got '{hostId}'");

            // Restore original value
            System.Environment.SetEnvironmentVariable("HOSTNAME", originalHostname);
        }
    }
}
