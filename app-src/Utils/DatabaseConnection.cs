// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Amazon.SecretsManager;
using Amazon.SecretsManager.Model;
using Newtonsoft.Json;

namespace BAMCIS.MultiAZApp.Utils
{
    public interface IDatabaseConnection
    {
        public string GetConnectionString();
    }

    public class DatabaseConnection : IDatabaseConnection
    {
        private string connectionString = "";

        public DatabaseConnection()
        {
            try {
                string val = File.ReadAllText("/etc/secret").Trim();

                if (!String.IsNullOrEmpty(val))
                {
                    Dictionary<string, string> secrets = GetSecret(val).Result;
                    this.connectionString = $"Host={secrets["host"]};Port={secrets["port"]};Username={secrets["username"]};Password={secrets["password"]};Database={secrets["dbname"]};Timeout=2;";  
                } 
                else
                {
                    this.connectionString = String.Empty;
                }
            }
            catch (Exception e)
            {
                this.connectionString = String.Empty;
                File.AppendAllText("/var/log/secretrserror.log", e.Message);
            }     
        }

        public string GetConnectionString()
        {
            return this.connectionString;
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