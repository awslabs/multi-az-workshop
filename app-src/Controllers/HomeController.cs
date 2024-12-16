// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

using Amazon.CloudWatch.EMF.Logger;
using BAMCIS.MultiAZApp.Utils;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using System;
using System.Diagnostics;
using System.Threading;
using Newtonsoft.Json;
using System.Threading.Tasks;
using Npgsql;
using System.Collections.Generic;
using Amazon.CloudWatch.EMF.Model;
using System.Net.Mime; // Don't delete, needed for FAIL

namespace BAMCIS.MultiAZApp.Controllers
{
    [Route("/")]
    public class HomeController : Controller
    {
        private readonly ILogger<HomeController> logger;
        private readonly IMetricsLogger metrics;
        private readonly Random rand;
        private IMemoryCache cache;

        private ObjectResult DoWork() {
            Thread.Sleep(this.rand.Next(1, 20));
            this.Response.ContentType = MediaTypeNames.Application.Json;
            return Ok(new { region = EnvironmentUtils.GetRegion(), az = EnvironmentUtils.GetAZId(), statusCode = 200, instanceId = EnvironmentUtils.GetHostId() });
        }

        private ObjectResult DoWorkProbelm() {
            Thread.Sleep(this.rand.Next(1, 20));
            this.Response.ContentType = MediaTypeNames.Application.Json;
            return Problem(statusCode: 500, type: null, detail: JsonConvert.SerializeObject(new { region = EnvironmentUtils.GetRegion(), az = EnvironmentUtils.GetAZId(), statusCode = 500, instanceId = EnvironmentUtils.GetHostId() }));
        }

        public HomeController(ILogger<HomeController> logger, IMetricsLogger metrics, IMemoryCache cache)
        {
            this.logger = logger;
            this.metrics = metrics;
            this.rand = new Random();
            this.cache = cache;
        }

        [Route("health")]
        [HttpGet]
        public IActionResult HealthCheck()
        {
            return DoWork();
        }

        // GET: /home
        [Route("home")]
        [HttpGet]
        public IActionResult Home()
        {
            return DoWork();
        }

        // GET: /signin
        [Route("signin")]
        [HttpGet]
        public IActionResult Signin()
        {
            return DoWork();
        }

        // GET: /pay
        [Route("pay")]
        [HttpGet]
        public IActionResult Pay()
        {
            #if FAIL
                return DoWorkProbelm();
            #else
                return DoWork();
            #endif
        }

        // GET: /ride
        [Route("ride")]
        [HttpGet]
        public async Task<IActionResult> Ride()
        {
            this.Response.ContentType = MediaTypeNames.Application.Json;
            if (this.cache.TryGetValue<string>("ConnectionString", out string connString) && !String.IsNullOrEmpty(connString))
            {
                try {  
                    await using var dataSource = NpgsqlDataSource.Create(connString);
                    await using var command = dataSource.CreateCommand("SELECT tablename FROM pg_tables");
                    Stopwatch sw = new Stopwatch();
                    sw.Start();

                    await using var reader = await command.ExecuteReaderAsync();

                    List<string> content = new List<string>();
                    while (await reader.ReadAsync())
                    {
                        content.Add(reader.GetString(0));
                    }

                    sw.Stop();
                    this.metrics.PutMetric("QueryLatency", sw.ElapsedMilliseconds, Unit.MILLISECONDS);

                    return Ok(new { region = EnvironmentUtils.GetRegion(), az = EnvironmentUtils.GetAZId(), statusCode = 200, instanceId = EnvironmentUtils.GetInstanceId(), tables = content.ToArray() });
                }
                catch (Exception e)
                {
                    this.metrics.PutProperty("Exception", e);
                    return Problem(detail: JsonConvert.SerializeObject(new { region = EnvironmentUtils.GetRegion(), az = EnvironmentUtils.GetAZId(), statusCode = 500, instanceId = EnvironmentUtils.GetInstanceId(), exception = e }), statusCode: 500, type: null);
                }
            }
            else
            {
                this.metrics.PutProperty("Exception", "No connection string.");
                return Problem(detail: JsonConvert.SerializeObject(new { region = EnvironmentUtils.GetRegion(), az = EnvironmentUtils.GetAZId(), statusCode = 404, instanceId = EnvironmentUtils.GetInstanceId(), problem = "Connection string was empty, check secrets manager configuration." }), statusCode: 404, type: null);
            }
        }
    }
}
