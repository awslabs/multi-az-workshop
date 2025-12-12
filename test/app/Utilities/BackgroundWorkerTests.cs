using Xunit;
using Moq;
using BAMCIS.MultiAZApp.Utilities;

namespace BAMCIS.MultiAZApp.Tests.Utilities
{
    public class BackgroundWorkerTests
    {
        [Fact]
        public void Constructor_WithWorker_CreatesInstance()
        {
            var mockWorker = new Mock<IWorker>();

            var backgroundWorker = new BackgroundWorker(mockWorker.Object);

            Assert.NotNull(backgroundWorker);
        }

        [Fact]
        public async Task ExecuteAsync_CallsWorkerDoWork()
        {
            var mockWorker = new Mock<IWorker>();
            var cts = new CancellationTokenSource();
            
            mockWorker.Setup(w => w.DoWork(It.IsAny<CancellationToken>()))
                .Returns(Task.CompletedTask);

            var backgroundWorker = new BackgroundWorker(mockWorker.Object);

            cts.Cancel();
            await backgroundWorker.StartAsync(cts.Token);

            mockWorker.Verify(w => w.DoWork(It.IsAny<CancellationToken>()), Times.Once);
        }
    }
}
