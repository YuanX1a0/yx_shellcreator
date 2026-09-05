using Newtonsoft.Json;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace YxShellCreator.Server.Models
{
    internal sealed class ResourceConfig
    {
        [JsonProperty("schemaVersion")] public int SchemaVersion { get; set; } = 3;
        [JsonProperty("bucketBase")] public int BucketBase { get; set; } = 7500;
        [JsonProperty("maxObjectsPerHouse")] public int MaxObjectsPerHouse { get; set; } = 800;
        [JsonProperty("customInteriorAnchor")] public Transform CustomInteriorAnchor { get; set; } = new Transform();
        [JsonProperty("interiors")] public List<InteriorPreset> Interiors { get; set; } = new List<InteriorPreset>();
    }

    internal sealed class InteriorPreset
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("label")] public string Label { get; set; }
        [JsonProperty("type")] public string Type { get; set; }
        [JsonProperty("description")] public string Description { get; set; }
        [JsonProperty("spawn")] public Transform Spawn { get; set; }
        [JsonProperty("exit")] public Transform Exit { get; set; }
    }

    internal sealed class Transform
    {
        [JsonProperty("x")] public double X { get; set; }
        [JsonProperty("y")] public double Y { get; set; }
        [JsonProperty("z")] public double Z { get; set; }
        [JsonProperty("h")] public double H { get; set; }
    }

    internal sealed class Rotation
    {
        [JsonProperty("x")] public double X { get; set; }
        [JsonProperty("y")] public double Y { get; set; }
        [JsonProperty("z")] public double Z { get; set; }
    }

    internal sealed class HouseRecord
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("slug")] public string Slug { get; set; }
        [JsonProperty("label")] public string Label { get; set; }
        [JsonProperty("presetId")] public string PresetId { get; set; }
        [JsonProperty("shellModel")] public string ShellModel { get; set; }
        [JsonProperty("bucket")] public int Bucket { get; set; }
        [JsonProperty("entrance")] public Transform Entrance { get; set; }
        [JsonProperty("spawn")] public Transform Spawn { get; set; }
        [JsonProperty("exit")] public Transform Exit { get; set; }
        [JsonProperty("environment")] public HouseEnvironment Environment { get; set; } = new HouseEnvironment();
        [JsonProperty("accessPoints")] public List<HouseAccessPoint> AccessPoints { get; set; } = new List<HouseAccessPoint>();
    }

    internal sealed class HouseAccessPoint
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("label")] public string Label { get; set; }
        [JsonProperty("entrance")] public Transform Entrance { get; set; }
        [JsonProperty("exit")] public Transform Exit { get; set; }
    }

    internal sealed class AccessPointRequest : HouseIdRequest
    {
        [JsonProperty("action")] public string Action { get; set; }
        [JsonProperty("pointId")] public string PointId { get; set; }
        [JsonProperty("label")] public string Label { get; set; }
        [JsonProperty("transform")] public Transform Transform { get; set; }
    }

    internal sealed class PassageRequest : HouseIdRequest
    {
        [JsonProperty("pointId")] public string PointId { get; set; }
    }

    internal sealed class PushDoorRequest : DeleteObjectRequest
    {
        [JsonProperty("direction")] public int Direction { get; set; }
    }

    internal sealed class HouseEnvironment
    {
        [JsonProperty("weather")] public string Weather { get; set; } = "INHERIT";
        [JsonProperty("hour")] public int? Hour { get; set; }
        [JsonProperty("minute")] public int? Minute { get; set; }
    }

    internal sealed class SetEnvironmentRequest : HouseIdRequest
    {
        [JsonProperty("environment")] public HouseEnvironment Environment { get; set; }
    }

    internal sealed class ImportHouseRequest : RequestBase
    {
        [JsonProperty("slug")] public string Slug { get; set; }
        [JsonProperty("label")] public string Label { get; set; }
        [JsonProperty("entrance")] public Transform Entrance { get; set; }
        [JsonProperty("document")] public JObject Document { get; set; }
    }

    internal sealed class DecorationRecord
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("houseId")] public string HouseId { get; set; }
        [JsonProperty("model")] public string Model { get; set; }
        [JsonProperty("position")] public Transform Position { get; set; }
        [JsonProperty("rotation")] public Rotation Rotation { get; set; }
        [JsonProperty("sourceKind")] public string SourceKind { get; set; } = "placed";
        [JsonProperty("sourceModelHash")] public long? SourceModelHash { get; set; }
        [JsonProperty("sourcePosition")] public Transform SourcePosition { get; set; }
        [JsonProperty("hidden")] public bool Hidden { get; set; }
        [JsonProperty("doorOpen")] public bool DoorOpen { get; set; }
    }

    internal class RequestBase
    {
        [JsonProperty("requestId")] public string RequestId { get; set; }
    }

    internal class HouseIdRequest : RequestBase
    {
        [JsonProperty("houseId")] public string HouseId { get; set; }
    }

    internal sealed class CreateHouseRequest : RequestBase
    {
        [JsonProperty("slug")] public string Slug { get; set; }
        [JsonProperty("label")] public string Label { get; set; }
        [JsonProperty("presetId")] public string PresetId { get; set; }
        [JsonProperty("shellModel")] public string ShellModel { get; set; }
        [JsonProperty("entrance")] public Transform Entrance { get; set; }
    }

    internal sealed class UpdateHouseRequest : RequestBase
    {
        [JsonProperty("houseId")] public string HouseId { get; set; }
        [JsonProperty("label")] public string Label { get; set; }
        [JsonProperty("presetId")] public string PresetId { get; set; }
        [JsonProperty("shellModel")] public string ShellModel { get; set; }
        [JsonProperty("entrance")] public Transform Entrance { get; set; }
        [JsonProperty("currentPosition")] public Transform CurrentPosition { get; set; }
    }

    internal sealed class UpdateInteriorPointRequest : HouseIdRequest
    {
        [JsonProperty("kind")] public string Kind { get; set; }
        [JsonProperty("transform")] public Transform Transform { get; set; }
    }

    internal class CreateObjectRequest : RequestBase
    {
        [JsonProperty("houseId")] public string HouseId { get; set; }
        [JsonProperty("model")] public string Model { get; set; }
        [JsonProperty("position")] public Transform Position { get; set; }
        [JsonProperty("rotation")] public Rotation Rotation { get; set; }
    }

    internal sealed class CreateNativeObjectRequest : CreateObjectRequest
    {
        [JsonProperty("sourceModelHash")] public long SourceModelHash { get; set; }
        [JsonProperty("sourcePosition")] public Transform SourcePosition { get; set; }
    }

    internal sealed class UpdateObjectRequest : RequestBase
    {
        [JsonProperty("houseId")] public string HouseId { get; set; }
        [JsonProperty("objectId")] public string ObjectId { get; set; }
        [JsonProperty("position")] public Transform Position { get; set; }
        [JsonProperty("rotation")] public Rotation Rotation { get; set; }
    }

    internal class DeleteObjectRequest : RequestBase
    {
        [JsonProperty("houseId")] public string HouseId { get; set; }
        [JsonProperty("objectId")] public string ObjectId { get; set; }
    }

    internal sealed class SetDoorStateRequest : DeleteObjectRequest
    {
        [JsonProperty("open")] public bool Open { get; set; }
    }

    internal sealed class PlayerInteriorContext
    {
        public string HouseId { get; set; }
        public int OriginalBucket { get; set; }
        public Transform ReturnPosition { get; set; }
        public string EntryPointId { get; set; }
        public PlayerInteriorContext Previous { get; set; }
    }

    internal sealed class EnterPayload
    {
        [JsonProperty("house")] public HouseRecord House { get; set; }
        [JsonProperty("objects")] public List<DecorationRecord> Objects { get; set; }
        [JsonProperty("teleport")] public Transform Teleport { get; set; }
        [JsonProperty("resumed")] public bool Resumed { get; set; }
        [JsonProperty("recovery")] public bool Recovery { get; set; }
        [JsonProperty("depth")] public int Depth { get; set; }
    }
}
