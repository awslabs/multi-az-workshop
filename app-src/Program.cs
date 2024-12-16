// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Hosting;
using Serilog;

namespace BAMCIS.MultiAZApp
{
    public class Program
    {
        public static void Main(string[] args)
        {
            Log.Logger = new LoggerConfiguration().WriteTo.RollingFile("/var/log/multi-az-app_{Date}.log")
                .MinimumLevel.Debug()
                .Enrich.FromLogContext()
                .CreateLogger();

            CreateHostBuilder(args).Build().Run();

            Log.CloseAndFlush();
        }

        public static IHostBuilder CreateHostBuilder(string[] args) {
            return Host.CreateDefaultBuilder(args).ConfigureWebHostDefaults(webBuilder =>
                {
                    webBuilder.UseStartup<Startup>();
                    webBuilder.ConfigureKestrel((context, serverOptions) => {
                        serverOptions.AddServerHeader = true;
                        serverOptions.ListenAnyIP(5000);
                    });
                }
            ).UseSerilog();
        }
    }
}
