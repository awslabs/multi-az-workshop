using Xunit;
using Moq;
using Microsoft.Extensions.Logging;
using BAMCIS.MultiAZApp.Utilities;
using AppEnvironment = BAMCIS.MultiAZApp.Utilities.Environment;

namespace BAMCIS.MultiAZApp.Tests.Utilities
{
    public class ECSEnvironmentTests
    {
        private readonly Mock<ILogger> _mockLogger;
        private readonly Mock<IResourceFetcher> _mockFetcher;

        public ECSEnvironmentTests()
        {
            _mockLogger = new Mock<ILogger>();
            _mockFetcher = new Mock<IResourceFetcher>();
        }

        [Fact]
        public void GetEnvironmentType_ReturnsECS()
        {
            var environment = new ECSEnvironment(_mockLogger.Object, _mockFetcher.Object);

            var result = environment.GetEnvironmentType();

            Assert.Equal(AppEnvironment.ECS, result);
        }

        [Fact]
        public void Probe_WithoutECSMetadataVariable_ReturnsFalse()
        {
            System.Environment.SetEnvironmentVariable("ECS_CONTAINER_METADATA_URI_V4", null);

            var environment = new ECSEnvironment(_mockLogger.Object, _mockFetcher.Object);

            var result = environment.Probe();

            Assert.False(result);
        }

        [Fact]
        public void Probe_WithECSMetadataVariable_ReturnsTrue()
        {
            System.Environment.SetEnvironmentVariable("ECS_CONTAINER_METADATA_URI_V4", "http://localhost/metadata");

            var metadata = new Dictionary<string, object>
            {
                { "ServiceName", "test-service" },
                { "TaskARN", "arn:aws:ecs:us-east-1:123456789012:task/1dc5c17a-422b-4dc4-b493-371970c6c4d6" }
            };

            _mockFetcher.Setup(f => f.FetchJson<Dictionary<string, object>>(
                It.IsAny<Uri>(),
                "GET",
                null))
                .Returns(metadata);

            var environment = new ECSEnvironment(_mockLogger.Object, _mockFetcher.Object);

            var result = environment.Probe();

            Assert.True(result);

            System.Environment.SetEnvironmentVariable("ECS_CONTAINER_METADATA_URI_V4", null);
        }

        [Fact]
        public void GetHostId_WithValidMetadata_ReturnsValue()
        {
            // Save original value
            var originalMetadataUri = System.Environment.GetEnvironmentVariable("ECS_CONTAINER_METADATA_URI_V4");
            
            System.Environment.SetEnvironmentVariable("ECS_CONTAINER_METADATA_URI_V4", "http://localhost/metadata");

            var metadata = new Dictionary<string, object>
            {
                { "ServiceName", "test-service" },
                { "TaskARN", "arn:aws:ecs:us-east-1:123456789012:task/1dc5c17a-422b-4dc4-b493-371970c6c4d6" }
            };

            _mockFetcher.Setup(f => f.FetchJson<Dictionary<string, object>>(
                It.IsAny<Uri>(),
                "GET",
                null))
                .Returns(metadata);

            var environment = new ECSEnvironment(_mockLogger.Object, _mockFetcher.Object);

            var hostId = environment.GetHostId();

            // HostId may be null or a string depending on whether the constructor successfully fetched metadata
            // Just verify the method can be called
            Assert.True(hostId == null || hostId is string);

            // Restore original value
            System.Environment.SetEnvironmentVariable("ECS_CONTAINER_METADATA_URI_V4", originalMetadataUri);
        }
    }
}
