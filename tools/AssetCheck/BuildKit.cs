using System;
using System.IO;
using System.Linq;
using System.Xml;
using System.Xml.Linq;
using System.Text.Json;
using System.Globalization;
using System.Collections.Generic;
using CodeWalker.GameFiles;

// Small, deterministic compiler for the build kit's unskinned triangle meshes.
// Reuses the original kit shaders/textures; CodeWalker writes GTA resource files.
static class BuildKit
{
    public static void EmbedDoor(string root, string name)
    {
        if (name != "yx_door_wood" && name != "yx_door_modern") throw new Exception("Unknown door");
        var source = Path.Combine(root,"tools/converted_v13",name,"stream");
        var output = Path.Combine(root,"stream");
        var ydr = new YdrFile(); ydr.Load(File.ReadAllBytes(Path.Combine(source,name+".ydr")));
        var ybn = new YbnFile(); ybn.Load(File.ReadAllBytes(Path.Combine(source,name+"_col.ybn")));
        ydr.Drawable.Bound = ybn.Bounds;
        File.WriteAllBytes(Path.Combine(output,name+".ydr"),ydr.Save());
        var ytyp = new YtypFile(); ytyp.Load(File.ReadAllBytes(Path.Combine(source,name+".ytyp")));
        var xml = XElement.Parse(MetaXml.GetXml(ytyp.Meta));
        foreach (var dictionary in xml.Descendants("physicsDictionary")) dictionary.Value = "";
        File.WriteAllBytes(Path.Combine(output,name+".ytyp"),XmlMeta.GetRSCData(Doc(xml)));
        Console.WriteLine("Embedded standalone door collision: "+name);
    }

    static string F(double value) => value.ToString("0.########", CultureInfo.InvariantCulture);
    static XElement V(string tag, double[] v) => new XElement(tag,
        new XAttribute("x", F(v[0])), new XAttribute("y", F(v[1])), new XAttribute("z", F(v[2])));
    static XElement N(string tag, object value) => new XElement(tag, new XAttribute("value", value));
    static XmlDocument Doc(XElement xml) { var doc = new XmlDocument(); doc.LoadXml(xml.ToString()); return doc; }
    static double[][] Vectors(JsonElement array)
    {
        var values = array.EnumerateArray().Select(v => v.GetDouble()).ToArray();
        return Enumerable.Range(0, values.Length / 3).Select(i => new[] { values[i*3], -values[i*3+2], values[i*3+1] }).ToArray();
    }
    static (double[], double[]) Bounds(IEnumerable<double[]> vertices)
    {
        var all = vertices.ToArray();
        return (Enumerable.Range(0, 3).Select(i => all.Min(v => v[i])).ToArray(),
            Enumerable.Range(0, 3).Select(i => all.Max(v => v[i])).ToArray());
    }
    static double[] Center(double[] min, double[] max) => min.Zip(max, (a,b) => (a+b)/2).ToArray();
    static double Radius(double[] min, double[] max) => Math.Sqrt(min.Zip(max, (a,b) => (b-a)*(b-a)).Sum()) / 2;
    static IEnumerable<XElement> BoundProperties(double[] min, double[] max, double margin)
    {
        return new[] { V("BoxMin", min), V("BoxMax", max), V("BoxCenter", Center(min,max)),
            V("SphereCenter", Center(min,max)), N("SphereRadius", F(Radius(min,max))),
            N("Margin", F(margin)), N("Volume", 1), V("Inertia", new double[]{1,1,1}),
            N("MaterialIndex", 0), N("MaterialColourIndex", 0), N("ProceduralID", 0),
            N("RoomID", 0), N("PedDensity", 0), N("UnkFlags", 0), N("PolyFlags", 0), N("UnkType", 1) };
    }

    public static void Build(string root, string name)
    {
        root = Path.GetFullPath(root);
        if (!System.Text.RegularExpressions.Regex.IsMatch(name, "^yx_[a-z0-9_]+$")) throw new Exception("Invalid model name");
        var input = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "tools/generated", name + ".mesh.json")));
        var meshes = input.RootElement.GetProperty("geometries").EnumerateArray().ToArray();
        var template = name.Contains("collision") ? "yx_stairs_collision"
            : name.Contains("concrete") ? "yx_stairs_concrete" : "yx_stairs_oak";
        var source = Path.Combine(root, "tools/converted_v14c", template, "stream");
        var ydr = new YdrFile(); ydr.Load(File.ReadAllBytes(Path.Combine(source, template + ".ydr")));
        var drawable = XElement.Parse(YdrXml.GetXml(ydr));
        var shaderTemplates = drawable.Element("ShaderGroup").Element("Shaders").Elements().ToArray();
        var shaders = new XElement("Shaders");
        var geometries = new XElement("Geometries");
        var collisionVertices = new List<double[]>();
        var polygons = new XElement("Polygons");
        var shaderIndex = 0;
        foreach (var mesh in meshes)
        {
            var material = mesh.GetProperty("material").GetString().ToLowerInvariant() + "_flat";
            var shader = shaderTemplates.First(s => s.Descendants("Item").Any(p =>
                (string)p.Attribute("name") == "DiffuseSampler" && (string)p.Element("Name") == material));
            shaders.Add(new XElement(shader));
            var positions = Vectors(mesh.GetProperty("positions"));
            var normals = Vectors(mesh.GetProperty("normals"));
            var uvs = mesh.GetProperty("uvs").EnumerateArray().Select(v => v.GetDouble()).ToArray();
            var indices = mesh.GetProperty("indices").EnumerateArray().Select(v => v.GetInt32()).ToArray();
            var (min, max) = Bounds(positions);
            var vertexData = string.Join("\n", positions.Select((p,i) => string.Join(" ", p.Select(F)) + "   "
                + string.Join(" ", normals[i].Select(F)) + "   255 255 255 255   " + F(uvs[i*2]) + " " + F(uvs[i*2+1])));
            geometries.Add(new XElement("Item", N("ShaderIndex", shaderIndex++), V("BoundingBoxMin",min), V("BoundingBoxMax",max),
                new XElement("VertexBuffer", N("Flags",0), new XElement("Layout", new XAttribute("type","GTAV1"),
                    new XElement("Position"), new XElement("Normal"), new XElement("Colour0"), new XElement("TexCoord0")),
                    new XElement("Data", "\n" + vertexData + "\n")),
                new XElement("IndexBuffer", new XElement("Data", string.Join(" ", indices)))));
            var offset = collisionVertices.Count;
            collisionVertices.AddRange(positions);
            for (int i = 0; i < indices.Length; i += 3)
                polygons.Add(new XElement("Triangle", new XAttribute("m",0), new XAttribute("v1",offset+indices[i]),
                    new XAttribute("v2",offset+indices[i+1]), new XAttribute("v3",offset+indices[i+2]),
                    new XAttribute("f1",1), new XAttribute("f2",1), new XAttribute("f3",1)));
        }
        var (allMin, allMax) = Bounds(collisionVertices);
        var center = Center(allMin, allMax);
        drawable.Element("Name").Value = name;
        drawable.Element("BoundingBoxMin").ReplaceWith(V("BoundingBoxMin",allMin));
        drawable.Element("BoundingBoxMax").ReplaceWith(V("BoundingBoxMax",allMax));
        drawable.Element("BoundingSphereCenter").ReplaceWith(V("BoundingSphereCenter",center));
        drawable.Element("BoundingSphereRadius").ReplaceWith(N("BoundingSphereRadius",F(Radius(allMin,allMax))));
        drawable.Element("ShaderGroup").Element("Shaders").ReplaceWith(shaders);
        drawable.Element("DrawableModelsHigh").Element("Item").Element("Geometries").ReplaceWith(geometries);
        // Remove stale template LODs/bounds before compiling the new geometry.
        foreach (var tag in new[]{"DrawableModelsMedium","DrawableModelsLow","DrawableModelsVeryLow","Bounds"}) drawable.Element(tag)?.Remove();

        var child = new XElement("Item", new XAttribute("type","GeometryBVH"), BoundProperties(allMin,allMax,0.005),
            new XElement("CompositeTransform","1 0 0 0\n0 1 0 0\n0 0 1 0\n0 0 0 1"),
            new XElement("CompositeFlags1","MAP_WEAPON, MAP_DYNAMIC, MAP_ANIMAL, MAP_COVER, MAP_VEHICLE, MAP_STAIRS"),
            new XElement("CompositeFlags2","VEHICLE_NOT_BVH, VEHICLE_BVH, PED, RAGDOLL, ANIMAL, ANIMAL_RAGDOLL, OBJECT, PROJECTILE, TEST_CAMERA, TEST_AI, TEST_SCRIPT"),
            V("GeometryCenter",center), N("UnkFloat1",0), N("UnkFloat2",0),
            new XElement("Materials", new XElement("Item", N("Type",0),
                N("ProceduralID",0),N("RoomID",0),N("PedDensity",0),new XElement("Flags","FLAG_STAIRS"),N("MaterialColourIndex",0),N("Unk",0))),
            new XElement("Vertices", "\n"+string.Join("\n",collisionVertices.Select(p => string.Join(", ",p.Select((v,i) => F(v-center[i])))))+"\n"), polygons);
        var bounds = new XElement("Bounds",new XAttribute("type","Composite"),BoundProperties(allMin,allMax,0),new XElement("Children",child));
        var ybn = XmlYbn.GetYbn(Doc(new XElement("BoundsFile",bounds)));
        var result = XmlYdr.GetYdr(Doc(drawable));
        // Embed the same bounds so dynamically spawned props do not depend on an
        // independently streamed map collision dictionary becoming resident first.
        result.Drawable.Bound = ybn.Bounds;
        var output = Path.Combine(root,"stream");
        File.WriteAllBytes(Path.Combine(output,name+".ydr"),result.Save());
        File.WriteAllBytes(Path.Combine(output,name+"_col.ybn"),ybn.Save());
        File.Copy(Path.Combine(source,template+".ytd"),Path.Combine(output,name+".ytd"),true);
        var archetype = new XElement("Item",new XAttribute("type","CBaseArchetypeDef"),
            N("lodDist",200),N("flags",0),N("specialAttribute",0),V("bbMin",allMin),V("bbMax",allMax),
            V("bsCentre",center),N("bsRadius",F(Radius(allMin,allMax))),N("hdTextureDist",100),new XElement("name",name),
            new XElement("textureDictionary",name),new XElement("clipDictionary"),new XElement("drawableDictionary"),
            new XElement("physicsDictionary"),new XElement("assetType","ASSET_TYPE_DRAWABLE"),new XElement("assetName",name),new XElement("extensions"));
        var ytyp = new XElement("CMapTypes",new XElement("extensions"),new XElement("archetypes",archetype),new XElement("name",name),
            new XElement("dependencies"),new XElement("compositeEntityTypes",new XAttribute("itemType","CCompositeEntityType")));
        File.WriteAllBytes(Path.Combine(output,name+".ytyp"),XmlMeta.GetRSCData(Doc(ytyp)));
        Console.WriteLine($"Built {name}: {collisionVertices.Count} vertices; {polygons.Elements().Count()} collision triangles; embedded stair bounds");
    }
}
