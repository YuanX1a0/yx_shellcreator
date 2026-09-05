using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using YxShellCreator.Server.Models;
using YxShellCreator.Server.Services;

void Check(bool ok,string message) { if(!ok) throw new Exception(message); }
void Reject(Action action,string message) { try { action(); } catch(ArgumentException) { return; } throw new Exception("Accepted invalid input: "+message); }
var config=JsonConvert.DeserializeObject<ResourceConfig>(File.ReadAllText("config/config.json"));
var empty=config.Interiors.Find(p=>p.Type=="empty");
var world=config.Interiors.Find(p=>p.Type=="world");
var anchor=config.CustomInteriorAnchor;
var house=new HouseRecord {Id="old",Slug="old",Label="导出测试",PresetId=empty.Id,Bucket=7500,
    Spawn=new Transform{X=anchor.X,Y=anchor.Y,Z=anchor.Z+1,H=90},Exit=new Transform{X=anchor.X+2,Y=anchor.Y,Z=anchor.Z+1,H=180},
    Environment=new HouseEnvironment{Weather="RAIN",Hour=23,Minute=59}};
var objects=new List<DecorationRecord>{new DecorationRecord {Id="old-object",HouseId="old",Model="yx_door_wood",
    Position=new Transform{X=anchor.X+3,Y=anchor.Y+4,Z=anchor.Z},Rotation=new Rotation{Z=45},DoorOpen=true}};
var doc=HouseFileCodec.Export(house,objects,empty,config);
Check(!doc.ToString().Contains("old-object") && !doc.ToString().Contains("createdBy") && !doc.ToString().Contains("bucket"),"private/instance metadata leaked");
var destination=new Transform{X=100,Y=200,Z=30,H=42};
anchor.X+=50;
var imported=HouseFileCodec.Import(doc,config,"new","新房屋",destination,9000);
Check(imported.House.Id!="old" && imported.Objects[0].Id!="old-object","IDs not regenerated");
Check(imported.Objects[0].HouseId==imported.House.Id,"object parent mismatch");
Check(imported.House.Entrance.X==100 && imported.Objects[0].Position.X==anchor.X+3,"relative layout did not relocate");
Check(imported.Objects[0].DoorOpen && imported.Objects[0].Rotation.Z==45,"door/rotation round trip failed");
Check(imported.House.Environment.Hour==23 && imported.House.Environment.Weather=="RAIN","environment lost");
Check(imported.House.Spawn.H==90 && imported.House.Exit.H==180,"entry headings lost");
var roundtrip=HouseFileCodec.Export(imported.House,imported.Objects,empty,config);
Check(JToken.DeepEquals(doc["objects"],roundtrip["objects"]),"relative data changed in round-trip");

house.Entrance=new Transform {X=10,Y=20,Z=30,H=0};
house.AccessPoints.Add(new HouseAccessPoint {Id="old-portal",Label="后门",Entrance=new Transform {X=15,Y=30,Z=30,H=180},
    Exit=new Transform {X=anchor.X+8,Y=anchor.Y,Z=anchor.Z+1,H=90}});
var portals=HouseFileCodec.Export(house,objects,empty,config);
Check(!portals.ToString().Contains("old-portal"),"portal ID leaked");
var relocated=HouseFileCodec.Import(portals,config,"multi","多出入口",destination,9002);
var side=relocated.House.AccessPoints.Single();
Check(side.Id!="old-portal" && side.Label=="后门","portal identifiers or labels lost");
Check(side.Entrance.X==105 && side.Entrance.Y==210 && side.Entrance.H==180,"exterior entrance offset or heading lost");
Check(side.Exit.X==anchor.X+8 && side.Exit.H==90,"portal interior target lost");
var again=HouseFileCodec.Export(relocated.House,relocated.Objects,empty,config);
Check(JToken.DeepEquals(portals["house"]["accessPoints"],again["house"]["accessPoints"]),"portal round trip changed coordinates");
Check(HousePassages.Find(relocated.House,null).Id=="main","legacy enter must use main");
Check(ReferenceEquals(HousePassages.Arrival(relocated.House,HousePassages.Find(relocated.House,"main")),relocated.House.Spawn),"main entry must use spawn");
Check(ReferenceEquals(HousePassages.Arrival(relocated.House,HousePassages.Find(relocated.House,side.Id)),side.Exit),"side entry must land at paired interior");
Check(ReferenceEquals(HousePassages.Find(relocated.House,side.Id).Entrance,side.Entrance),"side exit must use paired exterior");
Check(HousePassages.Find(relocated.House,"deleted-point")==null,"stale point ID must not silently use main");
void BadPortal(Action<JObject> mutate,string message) {var copy=(JObject)portals.DeepClone();mutate(copy);Reject(()=>HouseFileCodec.Import(copy,config,"new","new",destination,1),message);}
BadPortal(d=>d["house"]["accessPoints"][0]["exit"]["x"]=999999,"far portal interior");
BadPortal(d=>d["house"]["accessPoints"][0]["entranceOffset"]["z"]=double.PositiveInfinity,"infinite portal exterior");
BadPortal(d=>d["house"]["accessPoints"][0]["label"]=" ","empty portal label");
BadPortal(d=>d["house"]["accessPoints"]=new JArray(Enumerable.Range(0,16).Select(_=>portals["house"]["accessPoints"][0].DeepClone())),"more than 16 total entrances");
house.AccessPoints.Clear();

house.PresetId=world.Id;house.Spawn=new Transform{X=-715,Y=-155,Z=37,H=1};house.Exit=house.Spawn;
objects[0].Position=new Transform{X=-714,Y=-154,Z=37};objects[0].SourceKind="native";
objects[0].SourceModelHash=4294967290;objects[0].SourcePosition=new Transform{X=-713,Y=-154,Z=37};objects[0].Hidden=true;
var worldDoc=HouseFileCodec.Export(house,objects,world,config);
var worldImport=HouseFileCodec.Import(worldDoc,config,"shop","店铺",destination,9100);
Check(worldImport.House.Spawn.X==-715 && worldImport.House.Entrance.X==100,"world property moved to wrong map location");
Check(worldImport.Objects[0].SourcePosition.X==-713 && worldImport.Objects[0].SourceModelHash==4294967290 && worldImport.Objects[0].Hidden,"native override lost");

void Bad(Action<JObject> mutate,string message) {var copy=(JObject)doc.DeepClone();mutate(copy);Reject(()=>HouseFileCodec.Import(copy,config,"new","new",destination,1),message);}
Bad(d=>d["version"]=2,"future version");
Bad(d=>d["house"]["presetId"]="missing","missing preset");
Bad(d=>d["objects"][0]["position"]["x"]=double.NaN,"NaN coordinate");
Bad(d=>((JObject)d["objects"][0]["position"]).Remove("z"),"missing coordinate");
Bad(d=>d["objects"][0]["position"]["x"]=999999,"distant object");
Bad(d=>d["objects"][0]["model"]="../evil","path as model");
Bad(d=>d["objects"][0]["hidden"]=true,"hidden placed object");
Bad(d=>d["house"]["environment"]["hour"]=24,"out of range clock");
Bad(d=>d["house"]["environment"]["hour"]=12.5,"fractional clock");
Bad(d=>d["house"]["environment"]["weather"]="malicious","invalid weather");
var limit=config.MaxObjectsPerHouse;config.MaxObjectsPerHouse=0;
Reject(()=>HouseFileCodec.Import(doc,config,"new","new",destination,1),"object limit");config.MaxObjectsPerHouse=limit;
Check(HouseFileCodec.ReadStoredEnvironment(null).Weather=="INHERIT","old database rows lack defaults");
Reject(()=>HouseFileCodec.ValidateEnvironment(new HouseEnvironment{Hour=1}),"partial clock");
var fixture=JObject.Parse(File.ReadAllText("tests/fixtures/house-v1.json"));
var fixtureImport=HouseFileCodec.Import(fixture,config,"fixture","Fixture",destination,9200);
Check(fixtureImport.Objects.Count==1 && fixtureImport.Objects[0].DoorOpen,"UI fixture cannot be imported by actual codec");
Check(fixtureImport.House.AccessPoints.Count==0,"legacy files without accessPoints must still import");
var maxFile=(JObject)fixture.DeepClone();
var many=new JArray();
for(var i=0;i<limit;i++) many.Add(fixture["objects"][0].DeepClone());
maxFile["objects"]=many;
var maxImport=HouseFileCodec.Import(maxFile,config,"max","Max",destination,9300);
Check(maxImport.Objects.Count==limit,"full-capacity house failed import");
Check(maxImport.Objects.Select(x=>x.Id).Distinct().Count()==limit,"object IDs collide");
var maxExport=HouseFileCodec.Export(maxImport.House,maxImport.Objects,empty,config);
Check(System.Text.Encoding.UTF8.GetByteCount(maxExport.ToString())<HouseFileCodec.MaxBytes-4096,"default maximum layout exceeds file size limit");
many.Add(fixture["objects"][0].DeepClone());
Reject(()=>HouseFileCodec.Import(maxFile,config,"too_many","Too many",destination,9301),"max objects plus one");
Console.WriteLine("PASS: export/import round trip, new identifiers, anchor relocation, world map preservation, native overrides, metadata privacy, paired passages/relocation and invalid payload rejection");
