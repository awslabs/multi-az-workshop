// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

using Xunit;

namespace BAMCIS.MultiAZApp.Tests.Utilities
{
    /// <summary>
    /// The tests that build environments or change the variables they read run one at a time.
    /// BaseEnvironment keeps the host's values (host id, region, AZ) in static fields on purpose:
    /// on a host they are set once and never change. A test builds several environments in one
    /// process, though, so an EKSEnvironment built by one test (EnvironmentProvider probes ECS,
    /// then EKS, then EC2) replaces the host id an ECSEnvironment test just set, and that test's
    /// Probe() reads false. xUnit runs test classes in parallel unless they share a collection.
    /// </summary>
    [CollectionDefinition(Name, DisableParallelization = true)]
    public class EnvironmentCollection
    {
        public const string Name = "Environment";
    }
}
