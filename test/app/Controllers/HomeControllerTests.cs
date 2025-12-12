using Xunit;
using Moq;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Caching.Memory;
using Amazon.CloudWatch.EMF.Logger;
using BAMCIS.MultiAZApp.Controllers;
using BAMCIS.MultiAZApp.Utilities;
using System.Net.Mime;
using Microsoft.AspNetCore.Http;

namespace BAMCIS.MultiAZApp.Tests.Controllers
{
    public class HomeControllerTests
    {
        private readonly Mock<ILogger<HomeController>> _mockLogger;
        private readonly Mock<IMetricsLogger> _mockMetrics;
        private readonly Mock<IMemoryCache> _mockCache;
        private readonly Mock<IEnvironment> _mockEnvironment;
        private readonly HomeController _controller;

        public HomeControllerTests()
        {
            _mockLogger = new Mock<ILogger<HomeController>>();
            _mockMetrics = new Mock<IMetricsLogger>();
            _mockCache = new Mock<IMemoryCache>();
            _mockEnvironment = new Mock<IEnvironment>();

            _mockEnvironment.Setup(e => e.GetRegion()).Returns("us-east-1");
            _mockEnvironment.Setup(e => e.GetAZId()).Returns("use1-az1");
            _mockEnvironment.Setup(e => e.GetInstanceId()).Returns("i-1234567890abcdef0");
            _mockEnvironment.Setup(e => e.GetHostId()).Returns("test-host");

            _controller = new HomeController(
                _mockLogger.Object,
                _mockMetrics.Object,
                _mockCache.Object,
                _mockEnvironment.Object
            );

            // Setup HttpContext
            _controller.ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext()
            };
        }

        [Fact]
        public void HealthCheck_ReturnsOkResult()
        {
            var result = _controller.HealthCheck();

            var okResult = Assert.IsType<OkObjectResult>(result);
            Assert.Equal(200, okResult.StatusCode);
        }

        [Fact]
        public void HealthCheck_ReturnsCorrectData()
        {
            var result = _controller.HealthCheck() as OkObjectResult;
            
            Assert.NotNull(result);
            Assert.NotNull(result.Value);
            
            // Use reflection to check the anonymous type properties
            var valueType = result.Value.GetType();
            var statusCodeProp = valueType.GetProperty("statusCode");
            var regionProp = valueType.GetProperty("region");
            var azIdProp = valueType.GetProperty("azId");
            var instanceIdProp = valueType.GetProperty("instanceId");
            var hostIdProp = valueType.GetProperty("hostId");
            
            Assert.Equal(200, statusCodeProp?.GetValue(result.Value));
            Assert.Equal("us-east-1", regionProp?.GetValue(result.Value));
            Assert.Equal("use1-az1", azIdProp?.GetValue(result.Value));
            Assert.Equal("i-1234567890abcdef0", instanceIdProp?.GetValue(result.Value));
            Assert.Equal("test-host", hostIdProp?.GetValue(result.Value));
        }

        [Fact]
        public void Home_ReturnsOkResult()
        {
            var result = _controller.Home();

            var okResult = Assert.IsType<OkObjectResult>(result);
            Assert.Equal(200, okResult.StatusCode);
        }

        [Fact]
        public void Signin_ReturnsOkResult()
        {
            var result = _controller.Signin();

            var okResult = Assert.IsType<OkObjectResult>(result);
            Assert.Equal(200, okResult.StatusCode);
        }

        [Fact]
        public void Pay_ReturnsOkResult()
        {
            var result = _controller.Pay();

            var okResult = Assert.IsType<OkObjectResult>(result);
            Assert.Equal(200, okResult.StatusCode);
        }

        [Fact]
        public async Task Ride_WithNoConnectionString_ReturnsProblem()
        {
            object cacheValue = null;
            _mockCache.Setup(c => c.TryGetValue("ConnectionString", out cacheValue))
                .Returns(false);

            var result = await _controller.Ride();

            var problemResult = Assert.IsType<ObjectResult>(result);
            Assert.Equal(404, problemResult.StatusCode);
        }

        [Fact]
        public async Task Ride_WithEmptyConnectionString_ReturnsProblem()
        {
            object cacheValue = "";
            _mockCache.Setup(c => c.TryGetValue("ConnectionString", out cacheValue))
                .Returns(true);

            var result = await _controller.Ride();

            var problemResult = Assert.IsType<ObjectResult>(result);
            Assert.Equal(404, problemResult.StatusCode);
        }
    }
}
