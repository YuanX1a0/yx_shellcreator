using CitizenFX.Core;
using CitizenFX.Core.Native;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using YxShellCreator.Server.Models;
using YxShellCreator.Server.Services;

namespace YxShellCreator.Server
{
    public sealed partial class Main
    {
        private readonly Dictionary<string, DateTime> _pushCooldowns = new Dictionary<string, DateTime>();
        private HashSet<string> _pushDoorModels;

        private async Task EnsurePassagesSchemaAsync()
        {
            var rows = await _database.QueryRowsAsync("SELECT `COLUMN_NAME` FROM `INFORMATION_SCHEMA`.`COLUMNS` WHERE `TABLE_SCHEMA`=DATABASE() AND `TABLE_NAME`='yx_shellcreator_houses' AND `COLUMN_NAME`='access_points_json'");
            if (rows.Count == 0) await _database.ExecuteAsync("ALTER TABLE `yx_shellcreator_houses` ADD COLUMN `access_points_json` TEXT NULL");
            var catalog = JObject.Parse(API.LoadResourceFile(API.GetCurrentResourceName(), "config/catalog.json"));
            _pushDoorModels = new HashSet<string>(((JArray)catalog["items"]).Where(i => i["door"] is JObject)
                .Select(i => (string)i["model"]), StringComparer.OrdinalIgnoreCase);
        }

        private static List<HouseAccessPoint> ReadAccessPoints(string json)
        {
            try { return JsonConvert.DeserializeObject<List<HouseAccessPoint>>(json ?? "") ?? new List<HouseAccessPoint>(); }
            catch { return new List<HouseAccessPoint>(); }
        }

        private static HouseAccessPoint FindAccessPoint(HouseRecord house, string id)
            => HousePassages.Find(house, id);

        private void OnAccessPoint([FromSource] Player source, string payload) => RunSafe(source, Parse<AccessPointRequest>(payload), HandleAccessPointAsync);

        private async Task HandleAccessPointAsync(Player source, AccessPointRequest request)
        {
            await _mutationLock.WaitAsync();
            try
            {
                if (!_houses.TryGetValue(request.HouseId ?? "", out var house)) { Respond(source, request.RequestId, false, null, "房屋不存在"); return; }
                var points = house.AccessPoints.Select(p => new HouseAccessPoint {Id=p.Id,Label=p.Label,Entrance=CopyTransform(p.Entrance),Exit=CopyTransform(p.Exit)}).ToList();
                var inside = CanBuild(source, house.Id, out var _);
                if (request.Action == "add" || request.Action == "entrance")
                {
                    if (inside) { Respond(source, request.RequestId, false, null, "请先离开当前房屋，到外部入口位置再设置"); return; }
                    if (!ValidWorldTransform(request.Transform)) { Respond(source, request.RequestId, false, null, "入口坐标无效"); return; }
                }
                if (request.Action == "add")
                {
                    if (points.Count >= 15) { Respond(source, request.RequestId, false, null, "每套房屋最多 16 个出入口（含默认入口）"); return; }
                    var label = NormalizeLabel(request.Label);
                    if (label.Length == 0 || label.Length > 40) { Respond(source, request.RequestId, false, null, "出入口名称应为 1–40 字"); return; }
                    points.Add(new HouseAccessPoint { Id=Guid.NewGuid().ToString(), Label=label,
                        Entrance=CopyTransform(request.Transform), Exit=CopyTransform(house.Exit) });
                }
                else
                {
                    var point = points.FirstOrDefault(p => p.Id == request.PointId);
                    if (point == null) { Respond(source, request.RequestId, false, null, "附加出入口不存在；默认点位请使用专用设置"); return; }
                    if (request.Action == "delete") points.Remove(point);
                    else if (request.Action == "entrance") point.Entrance=CopyTransform(request.Transform);
                    else if (request.Action == "exit")
                    {
                        if (!inside || !ValidInteriorTransform(request.Transform, house)) { Respond(source, request.RequestId, false, null, "请在该房屋内部设置屋内点位"); return; }
                        point.Exit=CopyTransform(request.Transform);
                    }
                    else { Respond(source, request.RequestId, false, null, "未知出入口操作"); return; }
                }
                await _database.ExecuteAsync("UPDATE `yx_shellcreator_houses` SET `access_points_json`=? WHERE `id`=?",new object[]{JsonConvert.SerializeObject(points),house.Id});
                house.AccessPoints=points;
                BroadcastHouses(); BroadcastHouseUpdate(house);
                Respond(source, request.RequestId, true, house, "出入口已保存；实体门不会自动变成传送点");
            }
            finally { _mutationLock.Release(); }
        }

        private void OnPushDoor([FromSource] Player source, string payload) => RunSafe(source, Parse<PushDoorRequest>(payload), HandlePushDoorAsync);

        private async Task HandlePushDoorAsync(Player source, PushDoorRequest request)
        {
            if (!CanBuild(source, request.HouseId, out var house) || (request.Direction != -1 && request.Direction != 1)) return;
            if (_pushCooldowns.TryGetValue(source.Handle, out var until) && until > DateTime.UtcNow) return;
            _pushCooldowns[source.Handle] = DateTime.UtcNow.AddMilliseconds(180);
            var item = await LoadObjectAsync(request.ObjectId, house.Id);
            if (item == null || item.Hidden || !_pushDoorModels.Contains(item.Model)) return;
            var ped = API.GetPlayerPed(source.Handle);
            if (ped == 0) return;
            var coords = API.GetEntityCoords(ped);
            if (Math.Pow(coords.X-item.Position.X,2)+Math.Pow(coords.Y-item.Position.Y,2)+Math.Pow(coords.Z-item.Position.Z,2)>36) return;
            BroadcastToHouse(house.Id, Prefix+":client:doorPushed", new {houseId=house.Id,objectId=item.Id,direction=request.Direction});
        }
    }
}
