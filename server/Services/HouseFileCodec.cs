using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using YxShellCreator.Server.Models;

namespace YxShellCreator.Server.Services
{
    internal sealed class ImportedHouse
    {
        public HouseRecord House;
        public List<DecorationRecord> Objects;
    }

    internal static class HouseFileCodec
    {
        public const int MaxBytes = 2 * 1024 * 1024;
        public const string Format = "yx_shellcreator.house";
        private static readonly Regex ModelName = new Regex("^[A-Za-z0-9_]{1,100}$");
        private static readonly HashSet<string> Weathers = new HashSet<string>(new[] {
            "INHERIT","EXTRASUNNY","CLEAR","CLOUDS","SMOG","FOGGY","OVERCAST","RAIN","THUNDER","CLEARING",
            "NEUTRAL","SNOW","BLIZZARD","SNOWLIGHT","XMAS","HALLOWEEN"
        }, StringComparer.Ordinal);

        public static HouseEnvironment ValidateEnvironment(HouseEnvironment value)
        {
            if (value == null || !Weathers.Contains(value.Weather ?? "")) throw new ArgumentException("天气设置无效");
            if (value.Hour.HasValue != value.Minute.HasValue || (value.Hour.HasValue
                && (value.Hour.Value < 0 || value.Hour.Value > 23 || value.Minute.Value < 0 || value.Minute.Value > 59)))
                throw new ArgumentException("时间必须为 00:00 至 23:59，或跟随服务器");
            return new HouseEnvironment { Weather = value.Weather, Hour = value.Hour, Minute = value.Minute };
        }

        public static HouseEnvironment ReadStoredEnvironment(string json)
        {
            try { return string.IsNullOrWhiteSpace(json) ? new HouseEnvironment() : ValidateEnvironment(JsonConvert.DeserializeObject<HouseEnvironment>(json)); }
            catch { return new HouseEnvironment(); }
        }

        private static HouseEnvironment ReadEnvironment(JToken token)
        {
            if (!(token is JObject obj) || obj["weather"]?.Type != JTokenType.String) throw new ArgumentException("缺少有效环境设置");
            foreach (var key in new[]{"hour","minute"})
                if (obj[key] != null && obj[key].Type != JTokenType.Null && obj[key].Type != JTokenType.Integer)
                    throw new ArgumentException("时间字段必须为整数");
            return ValidateEnvironment(obj.ToObject<HouseEnvironment>());
        }

        private static Transform Offset(Transform point, Transform origin) => new Transform { X=point.X-origin.X, Y=point.Y-origin.Y, Z=point.Z-origin.Z, H=point.H };
        private static Transform Add(Transform point, Transform origin) => new Transform { X=point.X+origin.X, Y=point.Y+origin.Y, Z=point.Z+origin.Z, H=point.H };
        private static Transform Copy(Transform point) => new Transform { X=point.X,Y=point.Y,Z=point.Z,H=point.H };
        private static bool Finite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
        private static bool World(Transform value) => value != null && Finite(value.X) && Finite(value.Y) && Finite(value.Z) && Finite(value.H)
            && Math.Abs(value.X)<=10000 && Math.Abs(value.Y)<=10000 && value.Z>=-1000 && value.Z<=3000 && Math.Abs(value.H)<=36000;
        private static bool Nearby(Transform point, Transform anchor) => World(point)
            && Math.Pow(point.X-anchor.X,2)+Math.Pow(point.Y-anchor.Y,2)+Math.Pow(point.Z-anchor.Z,2)<=62500;

        private static Transform ReadPoint(JToken token, bool heading = false)
        {
            if (!(token is JObject obj)) throw new ArgumentException("缺少坐标");
            foreach (var key in heading ? new[]{"x","y","z","h"} : new[]{"x","y","z"})
                if (obj[key] == null || (obj[key].Type != JTokenType.Float && obj[key].Type != JTokenType.Integer)
                    || !Finite((double)obj[key])) throw new ArgumentException("坐标必须是完整的有限数字");
            var point = obj.ToObject<Transform>();
            if (!Finite(point.H) || Math.Abs(point.H)>36000) throw new ArgumentException("朝向无效");
            return point;
        }

        private static bool ReadBool(JToken token)
        {
            if (token?.Type != JTokenType.Boolean) throw new ArgumentException("状态字段必须为 true/false");
            return (bool)token;
        }

        private static Transform Origin(HouseRecord house, InteriorPreset preset, ResourceConfig config)
        {
            if (preset.Type == "world") return Copy(house.Spawn);
            if (preset.Type == "empty" || preset.Type == "shell") return Copy(config.CustomInteriorAnchor);
            return Copy(preset.Spawn);
        }

        public static JObject Export(HouseRecord house, List<DecorationRecord> objects, InteriorPreset preset, ResourceConfig config)
        {
            var origin = Origin(house,preset,config);
            return new JObject {
                ["format"] = Format, ["version"] = 1, ["coordinateMode"] = "relative", ["exportedAt"] = DateTime.UtcNow.ToString("o"),
                ["house"] = new JObject {
                    ["label"]=house.Label, ["presetId"]=house.PresetId, ["presetType"]=preset.Type, ["shellModel"]=house.ShellModel,
                    ["origin"]=JObject.FromObject(origin), ["spawn"]=JObject.FromObject(Offset(house.Spawn,origin)),
                    ["exit"]=JObject.FromObject(Offset(house.Exit,origin)), ["environment"]=JObject.FromObject(house.Environment ?? new HouseEnvironment()),
                    ["accessPoints"]=new JArray(house.AccessPoints.Select(p=>new JObject {
                        ["label"]=p.Label, ["entranceOffset"]=JObject.FromObject(Offset(p.Entrance,house.Entrance)),
                        ["exit"]=JObject.FromObject(Offset(p.Exit,origin))
                    }))
                },
                ["objects"] = new JArray(objects.Select(item => new JObject {
                    ["model"]=item.Model,["position"]=JObject.FromObject(Offset(item.Position,origin)),["rotation"]=JObject.FromObject(item.Rotation),
                    ["sourceKind"]=item.SourceKind,["sourceModelHash"]=item.SourceModelHash,
                    ["sourcePosition"]=item.SourcePosition == null ? null : JObject.FromObject(Offset(item.SourcePosition,origin)),
                    ["hidden"]=item.Hidden,["doorOpen"]=item.DoorOpen
                })),
                ["requiredModels"] = new JArray(objects.Where(x=>x.SourceKind!="native").Select(x=>x.Model)
                    .Concat(string.IsNullOrEmpty(house.ShellModel) ? new string[0] : new[]{house.ShellModel}).Distinct())
            };
        }

        public static ImportedHouse Import(JObject document, ResourceConfig config, string slug, string label, Transform entrance, int bucket)
        {
            if (document == null || (string)document["format"] != Format || document["version"]?.Type != JTokenType.Integer
                || (int)document["version"] != 1 || (string)document["coordinateMode"] != "relative")
                throw new ArgumentException("不支持的房屋文件格式或版本");
            if (!World(entrance)) throw new ArgumentException("入口坐标无效");
            var meta = document["house"] as JObject;
            var items = document["objects"] as JArray;
            if (meta == null || items == null || items.Count > Math.Min(config.MaxObjectsPerHouse,2000))
                throw new ArgumentException("房屋文件缺少布局，或物件数量超过服务器限制");
            var presetId = (string)meta["presetId"];
            var preset = config.Interiors.FirstOrDefault(p=>p.Id==presetId);
            if (preset == null || (string)meta["presetType"] != preset.Type) throw new ArgumentException("此服务器没有文件指定的室内模板，或模板类型不一致");
            var originalOrigin = ReadPoint(meta["origin"],true);
            if (!World(originalOrigin)) throw new ArgumentException("原室内坐标无效");
            var origin = preset.Type == "world" ? originalOrigin
                : preset.Type == "empty" || preset.Type == "shell" ? config.CustomInteriorAnchor : preset.Spawn;
            if (!World(origin)) throw new ArgumentException("目标建造原点无效");
            var shell = (string)meta["shellModel"];
            if (preset.Type == "shell" && !ModelName.IsMatch(shell ?? "")) throw new ArgumentException("Shell 模型名无效");
            var house = new HouseRecord {
                Id=Guid.NewGuid().ToString(),Slug=slug,Label=label,PresetId=preset.Id,ShellModel=preset.Type=="shell" ? shell : null,
                Bucket=bucket,Entrance=Copy(entrance),Spawn=Add(ReadPoint(meta["spawn"],true),origin),Exit=Add(ReadPoint(meta["exit"],true),origin),
                Environment=ReadEnvironment(meta["environment"])
            };
            if (!Nearby(house.Spawn,origin) || !Nearby(house.Exit,house.Spawn)) throw new ArgumentException("室内出生点/出口越界");
            if (meta["accessPoints"] != null)
            {
                if (!(meta["accessPoints"] is JArray points) || points.Count > 15) throw new ArgumentException("最多允许 15 个附加出入口");
                foreach (var point in points)
                {
                    if (!(point is JObject obj) || obj["label"]?.Type != JTokenType.String) throw new ArgumentException("出入口记录无效");
                    var pointLabel=((string)obj["label"]).Trim();
                    var outside=Add(ReadPoint(obj["entranceOffset"],true),entrance);
                    var inside=Add(ReadPoint(obj["exit"],true),origin);
                    if (pointLabel.Length<1 || pointLabel.Length>40 || !World(outside) || !Nearby(inside,house.Spawn))
                        throw new ArgumentException("出入口名称或坐标无效");
                    house.AccessPoints.Add(new HouseAccessPoint {Id=Guid.NewGuid().ToString(),Label=pointLabel,Entrance=outside,Exit=inside});
                }
            }
            var objects = new List<DecorationRecord>();
            foreach (var token in items)
            {
                if (!(token is JObject item)) throw new ArgumentException("物件条目必须是 JSON 对象");
                var model = (string)item["model"];
                if (!ModelName.IsMatch(model ?? "")) throw new ArgumentException("物件模型名无效");
                var position=Add(ReadPoint(item["position"]),origin);
                var rotation=ReadPoint(item["rotation"]);
                if (!Nearby(position,house.Spawn) || Math.Abs(rotation.X)>36000 || Math.Abs(rotation.Y)>36000 || Math.Abs(rotation.Z)>36000)
                    throw new ArgumentException("物件坐标或旋转越界");
                var kind=(string)item["sourceKind"];
                if (kind!="placed" && kind!="native") throw new ArgumentException("不支持的物件来源");
                long? hash=null; Transform source=null;
                if (kind=="native")
                {
                    if (preset.Type!="builtin" && preset.Type!="world") throw new ArgumentException("此模板不支持原生家具修改");
                    if (item["sourceModelHash"]?.Type!=JTokenType.Integer) throw new ArgumentException("原生家具模型哈希无效");
                    hash=(long)item["sourceModelHash"];
                    source=Add(ReadPoint(item["sourcePosition"]),origin);
                    if (hash<=0 || hash>uint.MaxValue || !Nearby(source,house.Spawn)) throw new ArgumentException("原生家具来源无效");
                }
                var hidden=ReadBool(item["hidden"]);
                if (hidden && kind!="native") throw new ArgumentException("普通物件不能使用原生隐藏状态");
                objects.Add(new DecorationRecord {
                    Id=Guid.NewGuid().ToString(),HouseId=house.Id,Model=model,Position=position,
                    Rotation=new Rotation{X=rotation.X,Y=rotation.Y,Z=rotation.Z},SourceKind=kind,SourceModelHash=hash,
                    SourcePosition=source,Hidden=hidden,DoorOpen=ReadBool(item["doorOpen"])
                });
            }
            return new ImportedHouse { House=house,Objects=objects };
        }
    }
}
