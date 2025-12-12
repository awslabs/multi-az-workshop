using Xunit;
using Moq;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Caching.Memory;
using BAMCIS.MultiAZApp.Utilities;

namespace BAMCIS.MultiAZApp.Tests.Utilities
{
    public class CacheRefreshWorkerTests
    {
        private readonly Mock<ILogger<CacheRefreshWorker>> _mockLogger;
        private readonly Mock<IMemoryCache> _mockCache;
        private readonly Mock<IEnvironment> _mockEnvironment;

        public CacheRefreshWorkerTests()
        {
            _mockLogger = new Mock<ILogger<CacheRefreshWorker>>();
            _mockCache = new Mock<IMemoryCache>();
            _mockEnvironment = new Mock<IEnvironment>();

            _mockEnvironment.Setup(e => e.GetRegion()).Returns("us-east-1");
            _mockEnvironment.Setup(e => e.GetAZId()).Returns("use1-az1");
            _mockEnvironment.Setup(e => e.GetInstanceId()).Returns("i-1234567890abcdef0");
            _mockEnvironment.Setup(e => e.GetHostId()).Returns("test-host");
            _mockEnvironment.Setup(e => e.GetAZ()).Returns("us-east-1a");
            _mockEnvironment.Setup(e => e.IsOneBox()).Returns(false);
        }

        [Fact]
        public void Constructor_CreatesInstance()
        {
            var worker = new CacheRefreshWorker(
                _mockLogger.Object,
                _mockCache.Object,
                _mockEnvironment.Object
            );

            Assert.NotNull(worker);
        }

        [Fact]
        public async Task DoWork_WithCancellation_StopsExecution()
        {
            var cts = new CancellationTokenSource();
            cts.Cancel();

            var worker = new CacheRefreshWorker(
                _mockLogger.Object,
                _mockCache.Object,
                _mockEnvironment.Object
            );

            await worker.DoWork(cts.Token);

            Assert.True(cts.Token.IsCancellationRequested);
        }
    }
}
