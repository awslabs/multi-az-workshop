using Xunit;
using Moq;
using Microsoft.Extensions.Logging;
using BAMCIS.MultiAZApp.Utilities;
using AppEnvironment = BAMCIS.MultiAZApp.Utilities.Environment;

namespace BAMCIS.MultiAZApp.Tests.Utilities
{
    public class DefaultEnvironmentTests
    {
        private readonly Mock<ILogger> _mockLogger;
        private readonly Mock<IResourceFetcher> _mockFetcher;
        private readonly DefaultEnvironment _environment;

        public DefaultEnvironmentTests()
        {
            _mockLogger = new Mock<ILogger>();
            _mockFetcher = new Mock<IResourceFetcher>();
            _environment = new DefaultEnvironment(_mockLogger.Object, _mockFetcher.Object);
        }

        [Fact]
        public void Probe_ReturnsTrue()
        {
            var result = _environment.Probe();

            Assert.True(result);
        }

        [Fact]
        public void GetEnvironmentType_ReturnsLocal()
        {
            var result = _environment.GetEnvironmentType();

            Assert.Equal(AppEnvironment.LOCAL, result);
        }

        [Fact]
        public void GetHostId_ReturnsLocalhost()
        {
            var result = _environment.GetHostId();

            Assert.Equal("localhost", result);
        }

        [Fact]
        public void GetInstanceId_ReturnsLocalhost()
        {
            var result = _environment.GetInstanceId();

            Assert.Equal("localhost", result);
        }

        [Fact]
        public void GetRegion_ReturnsLocalhost()
        {
            var result = _environment.GetRegion();

            Assert.Equal("localhost", result);
        }

        [Fact]
        public void GetAZId_ReturnsLocalhost()
        {
            var result = _environment.GetAZId();

            Assert.Equal("localhost", result);
        }

        [Fact]
        public void GetAZ_ReturnsLocalhost()
        {
            var result = _environment.GetAZ();

            Assert.Equal("localhost", result);
        }

        [Fact]
        public void IsOneBox_ReturnsFalse()
        {
            var result = _environment.IsOneBox();

            Assert.False(result);
        }
    }
}
