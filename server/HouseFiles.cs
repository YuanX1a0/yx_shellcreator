using CitizenFX.Core;
using CitizenFX.Core.Native;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using YxShellCreator.Server.Models;
using YxShellCreator.Server.Services;

namespace YxShellCreator.Server
{
    public sealed partial class Main
    {
        private readonly Dictionary<string, DateTime> _fileCooldowns = new Dictionary<string, DateTime>();

        private async Task EnsureHouseEnvironmentSchemaAsync()
        {
            var rows=await _database.QueryRowsAsync("SELECT `COLUMN_NAME` FROM `INFORMATION_SCHEMA`.`COLUMNS` WHERE `TABLE_SCHEMA`=DATABASE() AND `TABLE_NAME`='yx_shellcreator_houses' AND `COLUMN_NAME`='environment_json'");
            if (rows.Count==0) await _database.ExecuteAsync("ALTER TABLE `yx_shellcreator_houses` ADD COLUMN `environment_json` TEXT NULL");
        }

        private bool AllowHouseFile(Player source, string requestId)
        {
            if (_fileCooldowns.TryGetValue(source.Handle,out var until) && until>DateTime.UtcNow)
            { Respond(source,requestId,false,null,"导入/导出请间隔 5 秒再试"); return false; }
            _fileCooldowns[source.Handle]=DateTime.UtcNow.AddSeconds(5);
            return true;
        }

        private void OnSetEnvironment([FromSource] Player source,string payload) => RunSafe(source,Parse<SetEnvironmentRequest>(payload),HandleSetEnvironmentAsync);
        private void OnExportHouse([FromSource] Player source,string payload) => RunSafe(source,Parse<HouseIdRequest>(payload),HandleExportHouseAsync);
        private void OnImportHouse([FromSource] Player source,string payload) => RunSafe(source,Parse<ImportHouseRequest>(payload,HouseFileCodec.MaxBytes),HandleImportHouseAsync);

        private async Task HandleSetEnvironmentAsync(Player source,SetEnvironmentRequest request)
        {
            HouseEnvironment value;
            try { value=HouseFileCodec.ValidateEnvironment(request.Environment); }
            catch (ArgumentException ex) { Respond(source,request.RequestId,false,null,ex.Message); return; }
            await _mutationLock.WaitAsync();
            try
            {
                if (!CanBuild(source,request.HouseId,out var house)) { Respond(source,request.RequestId,false,null,"请先进入该房屋"); return; }
                await _database.ExecuteAsync("UPDATE `yx_shellcreator_houses` SET `environment_json`=? WHERE `id`=?",
                    new object[]{JsonConvert.SerializeObject(value),house.Id});
                house.Environment=value;
                BroadcastHouses(); BroadcastHouseUpdate(house);
                Respond(source,request.RequestId,true,house,"房屋天气和时间已保存，同房屋玩家立即生效");
            }
            finally { _mutationLock.Release(); }
        }

        private async Task HandleExportHouseAsync(Player source,HouseIdRequest request)
        {
            if (!AllowHouseFile(source,request.RequestId)) return;
            await _mutationLock.WaitAsync();
            try
            {
                if (!CanBuild(source,request.HouseId,out var house)) { Respond(source,request.RequestId,false,null,"请先进入要导出的房屋"); return; }
                var preset=FindPreset(house.PresetId);
                if (preset==null) { Respond(source,request.RequestId,false,null,"室内模板不存在"); return; }
                var objects=await LoadObjectsAsync(house.Id);
                var document=HouseFileCodec.Export(house,objects,preset,_config);
                var json=document.ToString(Formatting.Indented);
                if (Encoding.UTF8.GetByteCount(json)>HouseFileCodec.MaxBytes-4096)
                { Respond(source,request.RequestId,false,null,"房屋数据超过 2 MiB 导出限制"); return; }
                // Filename is generated here, never accepted from an import document.
                var filename="exports/"+house.Slug+"-"+DateTime.UtcNow.ToString("yyyyMMdd-HHmmss")+"-"+Guid.NewGuid().ToString("N").Substring(0,8)+".json";
                bool saved;
                try { saved=API.SaveResourceFile(API.GetCurrentResourceName(),filename,json,-1); }
                catch { saved=false; }
                Respond(source,request.RequestId,true,new { document, filename, saved },saved
                    ? "房屋文件已写入服务器资源 exports 目录，也可从面板复制 JSON" : "服务器写文件失败，仍可从面板复制完整 JSON 保存", latent:true);
            }
            finally { _mutationLock.Release(); }
        }

        private async Task HandleImportHouseAsync(Player source,ImportHouseRequest request)
        {
            if (!AllowHouseFile(source,request.RequestId)) return;
            var slug=(request.Slug ?? "").Trim().ToLowerInvariant();
            var label=NormalizeLabel(request.Label);
            if (!SlugPattern.IsMatch(slug) || label.Length<1 || label.Length>80 || !ValidWorldTransform(request.Entrance))
            { Respond(source,request.RequestId,false,null,"请填写有效的新房屋 ID、名称和入口"); return; }
            await _mutationLock.WaitAsync();
            try
            {
                if (_houses.Values.Any(h=>string.Equals(h.Slug,slug,StringComparison.OrdinalIgnoreCase)))
                { Respond(source,request.RequestId,false,null,"房屋 ID 已存在；导入不会覆盖已有房屋"); return; }
                ImportedHouse imported;
                try { imported=HouseFileCodec.Import(request.Document,_config,slug,label,request.Entrance,_nextBucket); }
                catch (Exception ex) when (ex is ArgumentException || ex is JsonException || ex is InvalidCastException || ex is FormatException || ex is OverflowException)
                { Respond(source,request.RequestId,false,null,"无法导入："+ex.Message); return; }
                var house=imported.House;
                var author=PlayerIdentifier(source);
                var queries=new List<object> { new {
                    query=@"INSERT INTO `yx_shellcreator_houses` (`id`,`slug`,`label`,`preset_id`,`shell_model`,`bucket`,
`entrance_x`,`entrance_y`,`entrance_z`,`entrance_h`,`spawn_x`,`spawn_y`,`spawn_z`,`spawn_h`,`exit_x`,`exit_y`,`exit_z`,`exit_h`,`environment_json`,`created_by`,`access_points_json`)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    values=new object[]{house.Id,house.Slug,house.Label,house.PresetId,house.ShellModel,house.Bucket,
                        house.Entrance.X,house.Entrance.Y,house.Entrance.Z,house.Entrance.H,house.Spawn.X,house.Spawn.Y,house.Spawn.Z,house.Spawn.H,
                        house.Exit.X,house.Exit.Y,house.Exit.Z,house.Exit.H,JsonConvert.SerializeObject(house.Environment),author,JsonConvert.SerializeObject(house.AccessPoints)}
                } };
                foreach (var item in imported.Objects) queries.Add(new {
                    query=@"INSERT INTO `yx_shellcreator_objects` (`id`,`house_id`,`model`,`pos_x`,`pos_y`,`pos_z`,`rot_x`,`rot_y`,`rot_z`,
`source_kind`,`source_model_hash`,`source_pos_x`,`source_pos_y`,`source_pos_z`,`hidden`,`door_open`,`created_by`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    values=new object[]{item.Id,house.Id,item.Model,item.Position.X,item.Position.Y,item.Position.Z,item.Rotation.X,item.Rotation.Y,item.Rotation.Z,
                        item.SourceKind,item.SourceModelHash,item.SourcePosition?.X,item.SourcePosition?.Y,item.SourcePosition?.Z,item.Hidden ? 1 : 0,item.DoorOpen ? 1 : 0,author}
                });
                // oxmysql executes these on one connection/transaction; no half-house
                // is published or left behind if any object insert fails.
                await _database.TransactionAsync(queries);
                _nextBucket++;
                _houses[house.Id]=house;
                API.SetRoutingBucketPopulationEnabled(house.Bucket,false);
                BroadcastHouses();
                Respond(source,request.RequestId,true,house,"房屋已导入（"+imported.Objects.Count+" 个物件），正在进入建造模式");
            }
            finally { _mutationLock.Release(); }
        }
    }
}
