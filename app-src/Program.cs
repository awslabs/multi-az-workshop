using Amazon.CloudWatch.EMF.Config;
using BAMCIS.MultiAZApp.Utilities;

var builder = WebApplication.CreateBuilder(args);

EnvironmentConfigurationProvider.Config = new Configuration
{
    ServiceName = Constants.SERVICE_NAME,
    LogGroupName = Constants.LOG_GROUP_NAME,
    ServiceType =  "WebApi"
};

builder.WebHost.ConfigureKestrel((context, serverOptions) => {
    serverOptions.AddServerHeader = true;
    serverOptions.ListenAnyIP(5000);
});

builder
    .RegisterServices()
    .Build()
    .SetupMiddleware()
    .Run();