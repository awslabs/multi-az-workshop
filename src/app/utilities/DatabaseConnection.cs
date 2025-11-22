// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

using Amazon.SecretsManager;
using Amazon.SecretsManager.Model;
using Newtonsoft.Json;

namespace BAMCIS.MultiAZApp.Utilities
{
    public interface IDatabaseConnection
    {
        public string GetConnectionString();
    }

    public class DatabaseConnection : IDatabaseConnection
    {
        private string _connectionString = "";

        public DatabaseConnection()
        {
            try {
                string val = File.ReadAllText("/etc/secret").Trim();

                if (!String.IsNullOrEmpty(val))
                {
                    Dictionary<string, string> secrets = GetSecret(val).Result;
                    this._connectionString = $"Host={secrets["host"]};Port={secrets["port"]};Username={secrets["username"]};Password={secrets["password"]};Database={secrets["dbname"]};Timeout=2;";  
                } 
                else
                {
                    this._connectionString = String.Empty;
                }
            }
            catch (Exception e)
            {
                this._connectionString = String.Empty;
                File.AppendAllText("/var/log/secretrserror.log", e.Message);
            }     
        }

        public string GetConnectionString()
        {
            return this._connectionString;
        }

        private static async Task<Dictionary<string, string>> GetSecret(string secretName)
        {
            IAmazonSecretsManager client = new AmazonSecretsManagerClient();

            GetSecretValueRequest request = new GetSecretValueRequest
            {
                SecretId = secretName,
                VersionStage = "AWSCURRENT", // VersionStage defaults to AWSCURRENT if unspecified.
            };

            GetSecretValueResponse response = await client.GetSecretValueAsync(request);
            string secret = response.SecretString;

            return JsonConvert.DeserializeObject<Dictionary<string, string>>(secret);           
        }  
    }
}