# Multi-AZ Workshop Application Tests

This directory contains comprehensive unit tests for the .NET web application using xUnit.

## Test Structure

```
test/app/
├── Controllers/
│   └── HomeControllerTests.cs          # Tests for HomeController endpoints
├── Utilities/
│   ├── BackgroundWorkerTests.cs        # Tests for BackgroundWorker
│   ├── BaseEnvironmentTests.cs         # Tests for BaseEnvironment
│   ├── CacheRefreshWorkerTests.cs      # Tests for CacheRefreshWorker
│   ├── ConstantsTests.cs               # Tests for Constants
│   ├── DatabaseConnectionTests.cs      # Tests for DatabaseConnection
│   ├── DefaultEnvironmentTests.cs      # Tests for DefaultEnvironment
│   ├── EC2EnvironmentTests.cs          # Tests for EC2Environment
│   ├── ECSEnvironmentTests.cs          # Tests for ECSEnvironment
│   ├── EKSEnvironmentTests.cs          # Tests for EKSEnvironment
│   ├── EnvironmentEnumTests.cs         # Tests for Environment enum
│   ├── EnvironmentProviderTests.cs     # Tests for EnvironmentProvider
│   └── ResourceFetcherTests.cs         # Tests for ResourceFetcher
└── MultiAzWorkshopApplication.Tests.csproj
```

## Running Tests

### Run all tests
```bash
cd test/app
dotnet test
```

### Run tests with coverage
```bash
dotnet test --collect:"XPlat Code Coverage"
```

### Run tests with detailed output
```bash
dotnet test --logger "console;verbosity=detailed"
```

## Test Coverage

The test suite aims for 100% line coverage of the application code, including:

- **Controllers**: All HTTP endpoints (health, home, signin, pay, ride)
- **Environment Detection**: EC2, ECS, EKS, and local environments
- **Background Workers**: Cache refresh and background service execution
- **Utilities**: Resource fetching, database connections, and constants

## Dependencies

- **xUnit**: Testing framework
- **Moq**: Mocking framework for dependencies
- **Microsoft.AspNetCore.Mvc.Testing**: Integration testing support
- **coverlet.collector**: Code coverage collection

## Test Patterns

Tests follow these patterns:
- Arrange-Act-Assert (AAA) pattern
- Mocking external dependencies (AWS services, HTTP clients, etc.)
- Testing both success and failure scenarios
- Verifying correct behavior with different environment configurations
