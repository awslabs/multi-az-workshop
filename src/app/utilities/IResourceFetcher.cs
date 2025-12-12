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