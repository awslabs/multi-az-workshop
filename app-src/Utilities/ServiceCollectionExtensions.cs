using System.Diagnostics;
using Amazon.CloudWatch.EMF.Config;
using Amazon.CloudWatch.EMF.Logger;
using Amazon.CloudWatch.EMF.Model;
using Amazon.XRay.Recorder.Core;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.Extensions.Primitives;

namespace BAMCIS.MultiAZApp.Utilities
{
    public static class ServiceCollectionExtensions
    {
        public static WebApplication SetupMiddleware(this WebApplication app)
        {
            // ******** Access the configuration ********
            var config = app.Configuration;

            app.UseXRay(Constants.XRAY_SEGMENT_NAME);
            app.SetupEmfMiddleware();
            app.SetupTracing();

            // Configure the HTTP request pipeline.
            if (!app.Environment.IsDevelopment())
            {
                app.UseHsts();
            }

            //app.UseHttpsRedirection();
            app.MapControllers();

            app.UseForwardedHeaders(new ForwardedHeadersOptions
            {
                ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
            });

            return app;
        }

        public static WebApplicationBuilder RegisterServices(this WebApplicationBuilder builder)
        {
            // ******* Access the configuration *******
            var config = builder.Configuration;

            IEnvironmentProvider provider = new EnvironmentProvider(LoggerFactory.Create(builder => builder.AddConsole()));
            IEnvironment env = provider.ResolveEnvironment();

            builder.Services.AddSingleton<IEnvironment>(env);
            
            // In-memory cache
            builder.Services.AddMemoryCache();

            // Add the refresh worker so that it can be injectged into the 
            // background service
            builder.Services.AddSingleton<IWorker, CacheRefreshWorker>();
            
            // Add hosted service to run the background worker, which will host the
            // cache refresh worker
            builder.Services.AddHostedService<BackgroundWorker>();
            builder.Services.AddControllers();        

            //builder.Services.AddSerilog();
            builder.Services.AddEmf(builder.Environment);
            builder.Services.AddOpenApi();

            return builder;
        }

        private static void AddEmf(this IServiceCollection services, IWebHostEnvironment env)
        {
            Console.WriteLine("IS DEVELOPMENT: " + env.IsDevelopment());
            Console.WriteLine("ENV: " + env.EnvironmentName);
            EnvironmentConfigurationProvider.Config = new Configuration(
                serviceName: Constants.SERVICE_NAME,
                serviceType: "WebApi",
                logGroupName: Constants.LOG_GROUP_NAME,
                logStreamName: String.IsNullOrEmpty(System.Environment.GetEnvironmentVariable("AWS_EMF_LOG_STREAM_NAME")) ?
                    String.Empty :
                    System.Environment.GetEnvironmentVariable("AWS_EMF_LOG_STREAM_NAME"),
                agentEndPoint: String.IsNullOrEmpty(System.Environment.GetEnvironmentVariable("AWS_EMF_AGENT_ENDPOINT")) ?
                    Amazon.CloudWatch.EMF.Sink.Endpoint.DEFAULT_TCP_ENDPOINT.ToString() :
                    System.Environment.GetEnvironmentVariable("AWS_EMF_AGENT_ENDPOINT"),
                agentBufferSize: Configuration.DEFAULT_AGENT_BUFFER_SIZE,
                environmentOverride: env != null && env.IsDevelopment() ? 
                    Amazon.CloudWatch.EMF.Environment.Environments.Local :
                    Amazon.CloudWatch.EMF.Environment.Environments.Agent
            );

            services.AddScoped<IMetricsLogger, MetricsLogger>();
            services.AddSingleton<Amazon.CloudWatch.EMF.Environment.IEnvironmentProvider, Amazon.CloudWatch.EMF.Environment.EnvironmentProvider>();
            services.AddSingleton<Amazon.CloudWatch.EMF.Environment.IResourceFetcher, Amazon.CloudWatch.EMF.Environment.ResourceFetcher>();
            services.AddSingleton<Amazon.CloudWatch.EMF.Config.IConfiguration>(Amazon.CloudWatch.EMF.Config.EnvironmentConfigurationProvider.Config);
        }

        private static void SetupTracing(this IApplicationBuilder app)
        {
            IEnvironment environment = app.ApplicationServices.GetRequiredService<IEnvironment>();
            bool onebox = environment.IsOneBox();
            string az = environment.GetAZ();
            string azId = environment.GetAZId();
            string region = environment.GetRegion();
            string env = environment.GetEnvironmentType().ToString();
            string hostId = environment.GetHostId();
            string instanceId = environment.GetInstanceId();

            app.Use((context, next) => {

                AWSXRayRecorder recorder = AWSXRayRecorder.Instance;
                recorder.AddAnnotation("AZ-ID", azId);
                recorder.AddMetadata("InstanceId", instanceId);
                recorder.AddMetadata("HostId", hostId);
                recorder.AddMetadata("Region", region);
                recorder.AddMetadata("AZ", az);
                recorder.AddMetadata("Environment", env);
                recorder.AddAnnotation("Source", "server");
                recorder.AddAnnotation("OneBox", onebox);

                return next(context);
            });
        }

        private static Task SetupMetricsLogger(HttpContext context, IMetricsLogger logger, IEnvironment environment) {

            bool onebox = environment.IsOneBox();
            string az = environment.GetAZ();
            string azId = environment.GetAZId();
            string region = environment.GetRegion();
            string env = environment.GetEnvironmentType().ToString();
            string hostId = environment.GetHostId();
            string instanceId = environment.GetInstanceId();
            
            logger.SetNamespace(onebox ? Constants.METRIC_NAMESPACE_ONE_BOX : Constants.METRIC_NAMESPACE);

            logger.PutProperty("AZ", az);
            logger.PutProperty("Path", context.Request.Path);
            logger.PutProperty("OneBox", onebox);
            logger.PutProperty("Environment", env);
            var endpoint = context.GetEndpoint();
            string operation = String.Empty;
        
            if (endpoint != null)
            {
                var actionDescriptor = endpoint?.Metadata.GetMetadata<ControllerActionDescriptor>();
                operation = actionDescriptor?.ActionName;
                
                if (!String.IsNullOrEmpty(operation))
                {
                    //recorder.AddAnnotation("Operation", operation);
                }
            }
            if (onebox)
            {
                logger.PutProperty("HostId", hostId);
                logger.PutProperty("InstanceId", instanceId);
                logger.SetNamespace(Constants.METRIC_NAMESPACE_ONE_BOX);
                logger.PutProperty("AZ-ID", azId);
                var regionDimensions = new DimensionSet();
                if (!String.IsNullOrEmpty(operation))
                {
                    regionDimensions.AddDimension("Operation", operation);
                }
                regionDimensions.AddDimension("Region", region);
                logger.SetDimensions(regionDimensions);
            }
            else
            {
                logger.SetNamespace(Constants.METRIC_NAMESPACE);
                var instanceOperationRegionDimensions = new DimensionSet();
                var instanceRegionDimensions = new DimensionSet();
                var regionAZDimensions = new DimensionSet();
                var regionDimensions = new DimensionSet();
                var hostRegionDimensions = new DimensionSet();
                var hostOperationRegionDimensions = new DimensionSet();
                if (!String.IsNullOrEmpty(operation))
                {   
                    instanceOperationRegionDimensions.AddDimension("Operation", operation);
                    instanceOperationRegionDimensions.AddDimension("Region", region);
                    instanceOperationRegionDimensions.AddDimension("InstanceId", instanceId);
                    hostOperationRegionDimensions.AddDimension("Operation", operation);
                    hostOperationRegionDimensions.AddDimension("Region", region);
                    hostOperationRegionDimensions.AddDimension("HostId", hostId);
                    regionAZDimensions.AddDimension("Operation", operation);
                    
                    regionDimensions.AddDimension("Operation", operation);
                }               
                instanceRegionDimensions.AddDimension("Region", region);
                instanceRegionDimensions.AddDimension("InstanceId", instanceId);
                hostRegionDimensions.AddDimension("Region", region);
                hostRegionDimensions.AddDimension("HostId", hostId);
                regionAZDimensions.AddDimension("Region", region);
                regionAZDimensions.AddDimension("AZ-ID", azId);
                
                regionDimensions.AddDimension("Region", region);
        
                logger.SetDimensions(
                    regionAZDimensions, 
                    regionDimensions,
                    instanceRegionDimensions,
                    hostRegionDimensions
                );
                if (instanceOperationRegionDimensions.DimensionKeys.Any()) {
                    logger.PutDimensions(instanceOperationRegionDimensions);
                }
                if (hostOperationRegionDimensions.DimensionKeys.Any()) {
                    logger.PutDimensions(hostOperationRegionDimensions);
                }
            }
    
            if (context?.Request?.Host != null)
            {
                logger.PutProperty("Host", context.Request.Host.Value);
            }
            if (context?.Request?.HttpContext?.Connection?.RemoteIpAddress != null)
            {
                logger.PutProperty("SourceIp", context.Request.HttpContext.Connection.RemoteIpAddress.ToString());
            }
            if (context.Request.Headers.TryGetValue("X-Forwarded-For", out StringValues value) && !String.IsNullOrEmpty(value) && value.Count > 0)
            {
                logger.PutProperty("X-Forwarded-For", value.ToArray());
            }
            // Include the X-Ray trace id if it is set
            // https://docs.aws.amazon.com/xray/latest/devguide/xray-concepts.html#xray-concepts-tracingheader
            if (context.Request.Headers.TryGetValue("X-Amzn-Trace-Id", out StringValues xRayTraceId) && !String.IsNullOrEmpty(xRayTraceId) && xRayTraceId.Count > 0)
            {
                logger.PutProperty("X-Amzn-Trace-Id", xRayTraceId[0]);
            }
            // If the request contains a w3c trace id, let's embed it in the logs
            // Otherwise we'll include the TraceIdentifier which is the connectionId:requestCount
            // identifier.
            // https://www.w3.org/TR/trace-context/#traceparent-header
            logger.PutProperty("TraceId", Activity.Current?.Id ?? context?.TraceIdentifier);
            if (!String.IsNullOrEmpty(Activity.Current?.TraceStateString))
            {
                logger.PutProperty("TraceState", Activity.Current.TraceStateString);
            }
            
            return Task.CompletedTask;
        }

        private static void SetupEmfMiddleware(this IApplicationBuilder app)
        {
            Stopwatch stopWatch = new Stopwatch();
            IEnvironment env = app.ApplicationServices.GetRequiredService<IEnvironment>();
            
            // Register the middleware to run on each request
            app.Use((context, next) => {
                
                stopWatch.Restart();

                IMetricsLogger logger = context.RequestServices.GetRequiredService<IMetricsLogger>();
                SetupMetricsLogger(context, logger, env);

                context.Response.OnStarting(() => {

                    stopWatch.Stop();

                    context.Response.Headers.Append("X-Server-Side-Latency", stopWatch.ElapsedMilliseconds.ToString());

                    if (context.Request.Headers.ContainsKey("X-Amzn-Trace-Id"))
                    {
                        context.Response.Headers.Append("X-Amzn-Trace-Id", context.Request.Headers["X-Amzn-Trace-Id"]);
                    }

                    if (context.Request.Headers.ContainsKey("X-Invocation-Id"))
                    {
                        context.Response.Headers.Append("X-Invocation-Id", context.Request.Headers["X-Invocation-Id"]);
                        logger.PutProperty("InvocationId", context.Request.Headers["X-Invocation-Id"]);
                    }

                    int status = context.Response.StatusCode;

                    logger.PutProperty("HttpStatusCode", status);
                
                    switch (status)
                    {
                        case int n when (n >= 200 && n <= 399):
                            logger.PutMetric("Success", 1, Unit.COUNT);
                            logger.PutMetric("Fault", 0, Unit.COUNT);
                            logger.PutMetric("Error", 0, Unit.COUNT);
                            logger.PutMetric("Failure", 0, Unit.COUNT);
                            logger.PutMetric("SuccessLatency", stopWatch.ElapsedMilliseconds, Unit.MILLISECONDS);
                            break;
                        case int n when (n >= 400 && n <= 499):
                            logger.PutMetric("Success", 0, Unit.COUNT);
                            logger.PutMetric("Fault", 0, Unit.COUNT);
                            logger.PutMetric("Error", 1, Unit.COUNT);
                            logger.PutMetric("Failure", 0, Unit.COUNT);
                            logger.PutMetric("ErrorLatency", stopWatch.ElapsedMilliseconds, Unit.MILLISECONDS);
                            break;
                        case int n when (n >= 500 && n <= 599):
                            logger.PutMetric("Success", 0, Unit.COUNT);
                            logger.PutMetric("Fault", 1, Unit.COUNT);
                            logger.PutMetric("Error", 0, Unit.COUNT);
                            logger.PutMetric("Failure", 0, Unit.COUNT);
                            logger.PutMetric("FaultLatency", stopWatch.ElapsedMilliseconds, Unit.MILLISECONDS);
                            break;
                        default:
                            logger.PutMetric("Success", 0, Unit.COUNT);
                            logger.PutMetric("Fault", 0, Unit.COUNT);
                            logger.PutMetric("Error", 0, Unit.COUNT);
                            logger.PutMetric("Failure", 1, Unit.COUNT);
                            logger.PutMetric("UnknownResponseLatency", stopWatch.ElapsedMilliseconds, Unit.MILLISECONDS);
                            break;
                    }

                    Guid id = Guid.NewGuid();
                    context.Response.Headers.Append("X-RequestId", id.ToString());
                    logger.PutProperty("RequestId", id.ToString());
             
                    return Task.CompletedTask;
                });

                return next(context);
            });
        }
    }
}