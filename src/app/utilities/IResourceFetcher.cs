// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

using System;
using System.Collections.Generic;

namespace BAMCIS.MultiAZApp.Utilities
{
    public interface IResourceFetcher
    {
        public T FetchJson<T>(Uri endpoint, string method, Dictionary<string, string> header = null);

        public string FetchString(Uri endpoint, string method, Dictionary<string, string> header = null);
    }
}