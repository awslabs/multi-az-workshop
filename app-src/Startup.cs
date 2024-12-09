// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using Amazon.CloudWatch.EMF.Config;
using Amazon.CloudWatch.EMF.Environment;
using Amazon.CloudWatch.EMF.Logger;
using BAMCIS.MultiAZApp.Utils;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace BAMCIS.MultiAZApp
{
    public class Startup
    {
        public Microsoft.Extensions.Configuration.IConfiguration Configuration { get; }

        public Startup(Microsoft.Extensions.Configuration.IConfiguration configuration, IHostEnvironment hostEnv)
        {
            this.Configuration = configuration;

            Amazon.CloudWatch.EMF.Config.EnvironmentConfigurationProvider.Config = new Amazon.CloudWatch.EMF.Config.Configuration
            {
                ServiceName = Constants.SERVICE_NAME,
                LogGroupName = Constants.LOG_GROUP_NAME,
                ServiceType =  "MVC",
                EnvironmentOverride = hostEnv.IsDevelopment()
                    ? Amazon.CloudWatch.EMF.Environment.Environments.Local
                    // Setting this to unknown will cause the SDK to attempt to 
                    // detect the environment. If you know the compute environment
                    // you will be running on, then you can set this yourself.
                    : Amazon.CloudWatch.EMF.Environment.Environments.EC2
            };
        }

        // This method gets called by the runtime. Use this method to add services to the container.
        // For more information on how to configure your application, visit https://go.microsoft.com/fwlink/?LinkID=398940
        public void ConfigureServices(IServiceCollection services)
        {
            // API controllers
            services.AddControllers();

            // Embedded metrics format services
            services.AddScoped<IMetricsLogger, MetricsLogger>();
            services.AddSingleton<IEnvironmentProvider, EnvironmentProvider>();
            services.AddSingleton<IResourceFetcher, ResourceFetcher>();
            services.AddSingleton(EnvironmentConfigurationProvider.Config);

            // In-memory cache
            services.AddMemoryCache();
            services.AddSingleton<IWorker, CacheRefreshWorker>();
        }

        // This method gets called by the runtime. Use this method to configure the HTTP request pipeline.
        public void Configure(IApplicationBuilder app, IWebHostEnvironment env)
        {
            app.UseXRay(Constants.XRAY_SEGMENT_NAME);

            app.UseForwardedHeaders(new ForwardedHeadersOptions
            {
                ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
            });

            app.UseRouting();
            app.UseEmfMiddleware();
            app.UseEndpoints(endpoints =>
            {
                endpoints.MapControllers();
            });

            if (env.IsDevelopment())
            {
                app.UseDeveloperExceptionPage();
            }
            else
            {             
                app.UseHsts();
            }

            app.UseStaticFiles();
        }
    }
}
