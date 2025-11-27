using Xunit;
using Moq;
using Microsoft.Extensions.Logging;
using BAMCIS.MultiAZApp.Utilities;

namespace BAMCIS.MultiAZApp.Tests.Utilities
{
    public class ResourceFetcherTests
    {
        [Fact]
        public void Constructor_WithoutLoggerFactory_CreatesInstance()
        {
            var fetcher = new ResourceFetcher();

            Assert.NotNull(fetcher);
        }

        [Fact]
        public void Constructor_WithLoggerFactory_CreatesInstance()
        {
            var mockLoggerFactory = new Mock<ILoggerFactory>();
            var mockLogger = new Mock<ILogger>();
            mockLoggerFactory.Setup(f => f.CreateLogger(It.IsAny<string>()))
                .Returns(mockLogger.Object);

            var fetcher = new ResourceFetcher(mockLoggerFactory.Object);

            Assert.NotNull(fetcher);
        }
    }
}
