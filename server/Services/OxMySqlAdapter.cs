using CitizenFX.Core;
using CitizenFX.Core.Native;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace YxShellCreator.Server.Services
{
    internal sealed class OxMySqlAdapter
    {
        private readonly ExportDictionary _exports;

        public OxMySqlAdapter(ExportDictionary exports)
        {
            _exports = exports;
        }

        public bool IsAvailable
        {
            get
            {
                try
                {
                    return string.Equals(API.GetResourceState("oxmysql"), "started", StringComparison.OrdinalIgnoreCase);
                }
                catch
                {
                    return false;
                }
            }
        }

        public async Task<List<Dictionary<string, object>>> QueryRowsAsync(string sql, object[] parameters = null)
        {
            var raw = await QueryRawAsync(sql, parameters ?? new object[0]);
            if (raw == null) return new List<Dictionary<string, object>>();

            var json = JsonConvert.SerializeObject(raw);
            return JsonConvert.DeserializeObject<List<Dictionary<string, object>>>(json)
                ?? new List<Dictionary<string, object>>();
        }

        public Task<object> ExecuteAsync(string sql, object[] parameters = null)
        {
            return QueryRawAsync(sql, parameters ?? new object[0]);
        }

        public async Task TransactionAsync(List<object> queries)
        {
            if (!IsAvailable) throw new InvalidOperationException("oxmysql is not started");
            dynamic oxmysql = _exports["oxmysql"];
            dynamic pending = oxmysql.transaction_async(queries.ToArray());
            object result = await pending;
            if (!(result is bool success) || !success) throw new InvalidOperationException("House import transaction rolled back");
        }

        private async Task<object> QueryRawAsync(string sql, object[] parameters)
        {
            if (!IsAvailable) throw new InvalidOperationException("oxmysql is not started");
            if (string.IsNullOrWhiteSpace(sql)) throw new ArgumentException("SQL is required", nameof(sql));

            dynamic oxmysql = _exports["oxmysql"];
            dynamic pending = oxmysql.query_async(sql, parameters);
            return await pending;
        }
    }
}
