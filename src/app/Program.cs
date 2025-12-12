using BAMCIS.MultiAZApp.Utilities;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.ConfigureKestrel((context, serverOptions) => {
    serverOptions.AddServerHeader = true;
    serverOptions.ListenAnyIP(5000);
});

builder
    .RegisterServices()
    .Build()
    .SetupMiddleware()
    .Run();

// Make Program class accessible to integration tests
public partial class Program { }