using Amazon.CloudWatch.EMF.Config;
using BAMCIS.MultiAZApp.Utilities;

var builder = WebApplication.CreateBuilder(args);

EnvironmentConfigurationProvider.Config = new Configuration
{
    ServiceName = Constants.SERVICE_NAME,
    LogGroupName = Constants.LOG_GROUP_NAME,
    ServiceType =  "WebApi",
    EnvironmentOverride = Amazon.CloudWatch.EMF.Environment.Environments.Agent,
    AgentEndPoint = "tcp://cwagent:25888"
    //EnvironmentOverride = builder.Environment.IsDevelopment() ? 
    //    Amazon.CloudWatch.EMF.Environment.Environments.Local :
    //    Amazon.CloudWatch.EMF.Environment.Environments.Agent
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