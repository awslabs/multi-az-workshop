# Integration Tests

This directory contains integration tests for the Multi-AZ Workshop application. These tests verify the full application stack including middleware, HTTP pipeline, and service interactions.

## Test Categories

### WebApplicationFactoryTests
Tests the complete HTTP pipeline using ASP.NET Core's WebApplicationFactory:
- All endpoint responses (health, home, signin, pay, ride)
- JSON content type validation
- Custom header presence (X-Server-Side-Latency, X-RequestId)
- Response structure validation

### MiddlewarePipelineTests
Tests middleware functionality and request processing:
- Custom header injection
- Trace ID propagation (X-Amzn-Trace-Id)
- Invocation ID handling
- Lambda request ID handling
- Environment provider integration
- Background service registration
- Concurrent request handling

### EnvironmentIntegrationTests
Tests environment detection and configuration:
- Default environment usage
- Environment override with mocks
- Consistent environment data across requests
- Environment provider caching

### CacheIntegrationTests
Tests in-memory caching and background workers:
- Memory cache registration
- Empty cache handling
- Connection string caching
- Background cache refresh worker startup

### ErrorHandlingTests
Tests error scenarios and edge cases:
- 404 responses for non-existent endpoints
- Error responses with proper JSON formatting
- Invalid HTTP method handling
- High request volume handling
- Error responses include environment information

### PerformanceTests
Tests application performance characteristics:
- Response time validation (< 1 second)
- Server-side latency header accuracy
- Concurrent request performance
- Endpoint performance consistency
- Request burst handling
- Sequential request latency consistency

## Running Integration Tests

### Run all integration tests
```bash
cd test/app
dotnet test --filter "FullyQualifiedName~Integration"
```

### Run specific test class
```bash
dotnet test --filter "FullyQualifiedName~WebApplicationFactoryTests"
```

### Run with detailed output
```bash
dotnet test --filter "FullyQualifiedName~Integration" --logger "console;verbosity=detailed"
```

### Run with coverage
```bash
dotnet test --filter "FullyQualifiedName~Integration" --collect:"XPlat Code Coverage"
```

## Test Statistics

- **Total Integration Tests**: 40+
- **Test Categories**: 6
- **Coverage Areas**:
  - HTTP endpoints
  - Middleware pipeline
  - Environment detection
  - Caching
  - Error handling
  - Performance

## Key Features Tested

### HTTP Pipeline
- ✅ All endpoints return correct status codes
- ✅ JSON content type on all responses
- ✅ Custom headers (X-Server-Side-Latency, X-RequestId)
- ✅ Trace ID propagation
- ✅ Lambda integration headers

### Middleware
- ✅ Request/response processing
- ✅ Header manipulation
- ✅ Metrics logging setup
- ✅ X-Ray tracing integration

### Environment
- ✅ Environment provider resolution
- ✅ Environment data consistency
- ✅ Mock environment injection
- ✅ Caching behavior

### Caching
- ✅ Memory cache registration
- ✅ Connection string caching
- ✅ Background worker startup
- ✅ Cache miss handling

### Error Handling
- ✅ 404 for non-existent routes
- ✅ 405 for invalid HTTP methods
- ✅ Proper error response formatting
- ✅ High load handling

### Performance
- ✅ Response time < 1 second
- ✅ Concurrent request handling
- ✅ Consistent latency
- ✅ Request burst handling

## Test Dependencies

Integration tests use:
- **Microsoft.AspNetCore.Mvc.Testing** - WebApplicationFactory for in-memory testing
- **xUnit** - Test framework
- **Moq** - Mocking framework for service overrides

## Notes

### Database Tests
The `/ride` endpoint requires a database connection. Integration tests verify:
- Proper error handling when connection string is missing
- Correct response format for errors
- Environment information in error responses

For full database integration testing, you would need:
- A test database instance
- AWS Secrets Manager configuration
- Connection string in cache

### AWS Service Integration
These tests run without actual AWS services:
- CloudWatch EMF metrics are configured but not sent
- X-Ray tracing is configured but not sent
- Secrets Manager is not accessed

For full AWS integration testing, you would need:
- AWS credentials configured
- Secrets Manager with test secrets
- CloudWatch Logs access
- X-Ray daemon running

### Background Workers
The CacheRefreshWorker runs in the background but:
- Tests don't wait for full refresh cycles
- AWS Secrets Manager calls will fail (expected)
- Worker continues running without crashing the app

## Best Practices

1. **Isolation**: Each test uses a fresh WebApplicationFactory
2. **No External Dependencies**: Tests don't require databases or AWS services
3. **Fast Execution**: All tests complete in seconds
4. **Deterministic**: Tests produce consistent results
5. **Comprehensive**: Cover happy paths and error scenarios

## Troubleshooting

### Tests Fail with "Program not found"
Ensure the main project has:
```xml
<InternalsVisibleTo Include="MultiAzWorkshopApplication.Tests" />
```

Or make Program class public:
```csharp
public partial class Program { }
```

### Tests Timeout
Increase test timeout in xunit.runner.json:
```json
{
  "methodDisplay": "method",
  "methodDisplayOptions": "all",
  "diagnosticMessages": true,
  "maxParallelThreads": 1
}
```

### Port Conflicts
WebApplicationFactory uses random ports by default. If you see port conflicts, ensure no other instances are running.
