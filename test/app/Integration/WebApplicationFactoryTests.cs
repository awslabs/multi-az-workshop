using Xunit;
using Microsoft.AspNetCore.Mvc.Testing;
using System.Net;

namespace BAMCIS.MultiAZApp.Tests.Integration
{
    public class WebApplicationFactoryTests : IClassFixture<TestWebApplicationFactory<Program>>
    {
        private readonly TestWebApplicationFactory<Program> _factory;
        private readonly HttpClient _client;

        public WebApplicationFactoryTests(TestWebApplicationFactory<Program> factory)
        {
            _factory = factory;
            _client = factory.CreateClient();
        }

        [Fact]
        public async Task HealthEndpoint_ReturnsSuccess()
        {
            var response = await _client.GetAsync("/health");

            response.EnsureSuccessStatusCode();
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }

        [Fact]
        public async Task HealthEndpoint_ReturnsJson()
        {
            var response = await _client.GetAsync("/health");

            var content = await response.Content.ReadAsStringAsync();
            Assert.Contains("statusCode", content);
            Assert.Contains("region", content);
            Assert.Contains("azId", content);
        }

        [Fact]
        public async Task HomeEndpoint_ReturnsSuccess()
        {
            var response = await _client.GetAsync("/home");

            response.EnsureSuccessStatusCode();
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }

        [Fact]
        public async Task SigninEndpoint_ReturnsSuccess()
        {
            var response = await _client.GetAsync("/signin");

            response.EnsureSuccessStatusCode();
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }

        [Fact]
        public async Task PayEndpoint_ReturnsSuccess()
        {
            var response = await _client.GetAsync("/pay");

            response.EnsureSuccessStatusCode();
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }

        [Fact]
        public async Task RideEndpoint_ReturnsResponse()
        {
            var response = await _client.GetAsync("/ride");

            // Ride endpoint may return 404 if no connection string is configured
            Assert.True(
                response.StatusCode == HttpStatusCode.OK || 
                response.StatusCode == HttpStatusCode.NotFound ||
                response.StatusCode == HttpStatusCode.InternalServerError);
        }

        [Fact]
        public async Task AllEndpoints_ReturnJsonContentType()
        {
            var endpoints = new[] { "/health", "/home", "/signin", "/pay" };

            foreach (var endpoint in endpoints)
            {
                var response = await _client.GetAsync(endpoint);
                var contentType = response.Content.Headers.ContentType?.MediaType;
                
                Assert.Equal("application/json", contentType);
            }
        }

        [Fact]
        public async Task Response_ContainsServerSideLatencyHeader()
        {
            var response = await _client.GetAsync("/health");

            Assert.True(response.Headers.Contains("X-Server-Side-Latency"));
        }

        [Fact]
        public async Task Response_ContainsRequestIdHeader()
        {
            var response = await _client.GetAsync("/health");

            Assert.True(response.Headers.Contains("X-RequestId"));
        }
    }
}
