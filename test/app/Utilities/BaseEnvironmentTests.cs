using Xunit;
using Moq;
using Microsoft.Extensions.Logging;
using BAMCIS.MultiAZApp.Utilities;
using AppEnvironment = BAMCIS.MultiAZApp.Utilities.Environment;

namespace BAMCIS.MultiAZApp.Tests.Utilities
{
    public class TestableBaseEnvironment : BaseEnvironment
    {
        private readonly AppEnvironment _environmentType;
        private readonly bool _probeResult;
        private readonly string _testHostId;

        public TestableBaseEnvironment(
            ILogger logger, 
            IResourceFetcher fetcher, 
            AppEnvironment environmentType = AppEnvironment.LOCAL,
            bool probeResult = true) 
            : base(logger, fetcher)
        {
            _environmentType = environmentType;
            _probeResult = probeResult;
            _testHostId = "test-host";
        }

        public override string GetHostId()
        {
            return _testHostId;
        }

        public override bool Probe()
        {
            return _probeResult;
        }

        public override AppEnvironment GetEnvironmentType()
        {
            return _environmentType;
        }
    }

    public class BaseEnvironmentTests
    {
        private readonly Mock<ILogger> _mockLogger;
        private readonly Mock<IResourceFetcher> _mockFetcher;

        public BaseEnvironmentTests()
        {
            _mockLogger = new Mock<ILogger>();
            _mockFetcher = new Mock<IResourceFetcher>();
        }

        [Fact]
        public void GetRegion_ReturnsValue()
        {
            var environment = new TestableBaseEnvironment(_mockLogger.Object, _mockFetcher.Object);

            var region = environment.GetRegion();

            Assert.NotNull(region);
        }

        [Fact]
        public void GetAZ_ReturnsValue()
        {
            var environment = new TestableBaseEnvironment(_mockLogger.Object, _mockFetcher.Object);

            var az = environment.GetAZ();

            Assert.NotNull(az);
        }

        [Fact]
        public void GetAZId_ReturnsValue()
        {
            var environment = new TestableBaseEnvironment(_mockLogger.Object, _mockFetcher.Object);

            var azId = environment.GetAZId();

            Assert.NotNull(azId);
        }

        [Fact]
        public void GetInstanceId_ReturnsValue()
        {
            var environment = new TestableBaseEnvironment(_mockLogger.Object, _mockFetcher.Object);

            var instanceId = environment.GetInstanceId();

            Assert.NotNull(instanceId);
        }

        [Fact]
        public void IsOneBox_ReturnsBool()
        {
            var environment = new TestableBaseEnvironment(_mockLogger.Object, _mockFetcher.Object);

            var isOneBox = environment.IsOneBox();

            Assert.IsType<bool>(isOneBox);
        }

        [Fact]
        public void GetHostId_ReturnsTestHost()
        {
            var environment = new TestableBaseEnvironment(_mockLogger.Object, _mockFetcher.Object);

            var hostId = environment.GetHostId();

            Assert.Equal("test-host", hostId);
        }

        [Fact]
        public void Probe_ReturnsTrue()
        {
            var environment = new TestableBaseEnvironment(_mockLogger.Object, _mockFetcher.Object, probeResult: true);

            var result = environment.Probe();

            Assert.True(result);
        }

        [Fact]
        public void GetEnvironmentType_ReturnsConfiguredType()
        {
            var environment = new TestableBaseEnvironment(_mockLogger.Object, _mockFetcher.Object, AppEnvironment.EC2);

            var result = environment.GetEnvironmentType();

            Assert.Equal(AppEnvironment.EC2, result);
        }
    }
}
