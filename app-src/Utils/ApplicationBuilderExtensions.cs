﻿// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using Amazon.CloudWatch.EMF.Logger;
using Amazon.CloudWatch.EMF.Model;
using Amazon.XRay.Recorder.Core;
using BAMCIS.MultiAZApp.Utils;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Primitives;
using System;
using System.Diagnostics;
using System.Threading.Tasks;

namespace BAMCIS.MultiAZApp.Utils
{
    public static class ApplicationBuilderExtensions
    {
        public static void UseEmfMiddleware(this IApplicationBuilder app)
        {
            app.UseEmfMiddleware((context, logger) =>
            {
                AWSXRayRecorder recorder = AWSXRayRecorder.Instance;
                recorder.AddAnnotation("AZ-ID", EnvironmentUtils.GetAZId());
                recorder.AddMetadata("InstanceId", EnvironmentUtils.GetInstanceId());
                recorder.AddMetadata("Region", EnvironmentUtils.GetRegion());
                recorder.AddAnnotation("Soure", "server");
                recorder.AddAnnotation("OneBox", EnvironmentUtils.IsOneBox());

                var endpoint = context.GetEndpoint();
                string operation = String.Empty;

                logger.PutProperty("InstanceId", EnvironmentUtils.GetHostId());
                logger.PutProperty("Ec2InstanceId", EnvironmentUtils.GetInstanceId());
                logger.PutProperty("AZ", EnvironmentUtils.GetAZ());

                if (endpoint != null)
                {
                    var actionDescriptor = endpoint?.Metadata.GetMetadata<ControllerActionDescriptor>();
                    operation = actionDescriptor?.ActionName;
                }

                if (EnvironmentUtils.IsOneBox())
                {
                    logger.SetNamespace(Constants.METRIC_NAMESPACE_ONE_BOX);
                    logger.PutProperty("AZ-ID", EnvironmentUtils.GetAZId());

                    var regionDimensions = new DimensionSet();

                    if (!String.IsNullOrEmpty(operation))
                    {
                        regionDimensions.AddDimension("Operation", operation);
                        recorder.AddAnnotation("Operation", operation);
                    }

                    regionDimensions.AddDimension("Region", EnvironmentUtils.GetRegion());

                    logger.SetDimensions(regionDimensions);
                }
                else
                {
                    logger.SetNamespace(Constants.METRIC_NAMESPACE);

                    var regionAZDimensions = new DimensionSet();
                    var regionDimensions = new DimensionSet();

                    if (!String.IsNullOrEmpty(operation))
                    {        
                        regionAZDimensions.AddDimension("Operation", operation);
                        regionDimensions.AddDimension("Operation", operation);
                        recorder.AddAnnotation("Operation", operation);
                    }

                    regionAZDimensions.AddDimension("Region", EnvironmentUtils.GetRegion());
                    regionAZDimensions.AddDimension("AZ-ID", EnvironmentUtils.GetAZId());
                    
                    regionDimensions.AddDimension("Region", EnvironmentUtils.GetRegion());
           
                    logger.SetDimensions(regionAZDimensions, regionDimensions);
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
                        break;
                    case int n when (n >= 400 && n <= 499):
                        logger.PutMetric("Success", 0, Unit.COUNT);
                        logger.PutMetric("Fault", 0, Unit.COUNT);
                        logger.PutMetric("Error", 1, Unit.COUNT);
                        logger.PutMetric("Failure", 0, Unit.COUNT);
                        break;
                    case int n when (n >= 500 && n <= 599):
                        logger.PutMetric("Success", 0, Unit.COUNT);
                        logger.PutMetric("Fault", 1, Unit.COUNT);
                        logger.PutMetric("Error", 0, Unit.COUNT);
                        logger.PutMetric("Failure", 0, Unit.COUNT);
                        break;
                    default:
                        logger.PutMetric("Success", 0, Unit.COUNT);
                        logger.PutMetric("Fault", 0, Unit.COUNT);
                        logger.PutMetric("Error", 0, Unit.COUNT);
                        logger.PutMetric("Failure", 1, Unit.COUNT);
                        break;
                }
                
                if (context?.Request?.Host != null)
                {
                    logger.PutProperty("Host", context.Request.Host.Value);
                }

                if (context.Request?.HttpContext?.Connection?.RemoteIpAddress != null)
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
                    logger.PutProperty("XRayTraceId", xRayTraceId[0]);
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

                logger.PutProperty("Path", context.Request.Path);
                logger.PutProperty("OneBox", EnvironmentUtils.IsOneBox());
                return Task.CompletedTask;
            });
        }

        public static void UseEmfMiddleware(this IApplicationBuilder app, Func<HttpContext, IMetricsLogger, Task> metricsSetup)
        {
            app.Use(async (context, next) =>
            {
                Stopwatch stopWatch = new Stopwatch();
                stopWatch.Start();

                var logger = context.RequestServices.GetRequiredService<IMetricsLogger>();

                // register this event first,
                // and then call the
                // next middleware component
                context.Response.OnStarting(() =>
                {
                    stopWatch.Stop();

                    context.Response.Headers.Append("X-Server-Side-Latency", stopWatch.ElapsedMilliseconds.ToString());

                    if (context.Request.Headers.ContainsKey("X-Amzn-Trace-Id"))
                    {
                        context.Response.Headers.Append("X-Amzn-Trace-Id", context.Request.Headers["X-Amzn-Trace-Id"]);
                    }

                    switch (context.Response.StatusCode)
                    {
                        case int n when (n >= 200 && n <= 399):
                            logger.PutMetric("SuccessLatency", stopWatch.ElapsedMilliseconds, Unit.MILLISECONDS);
                            break;
                        case int n when (n >= 400 && n <= 599):
                            logger.PutMetric("FaultLatency", stopWatch.ElapsedMilliseconds, Unit.MILLISECONDS);
                            break;
                        default:
                            logger.PutMetric("UnknownResponseLatency", stopWatch.ElapsedMilliseconds, Unit.MILLISECONDS);
                            break;
                    }

                    Guid id = Guid.NewGuid();
                    context.Response.Headers.Append("X-RequestId", id.ToString());
                    logger.PutProperty("RequestId", id.ToString());

                    return Task.CompletedTask;
                });
                
                await next(); // this will make the endpoints available in the logger setup
                await metricsSetup(context, logger);
            });
        }
    }
}