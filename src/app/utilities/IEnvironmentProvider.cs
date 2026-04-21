// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

namespace BAMCIS.MultiAZApp.Utilities
{
    public interface IEnvironmentProvider
    {
        IEnvironment ResolveEnvironment();
    }
}