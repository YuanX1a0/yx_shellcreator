using System;
using System.IO;
using CodeWalker.GameFiles;

if (args.Length == 2 && args[0] == "--embed-doors")
{
    BuildKit.EmbedDoor(args[1], "yx_door_wood");
    BuildKit.EmbedDoor(args[1], "yx_door_modern");
    return;
}

if (args.Length == 2 && args[0] == "--verify")
{
    VerifyKit.Verify(args[1]);
    return;
}

if (args.Length > 2 && args[0] == "--build")
{
    foreach (var name in args[2..]) BuildKit.Build(args[1], name);
    return;
}

foreach (var file in args)
{
    var data = File.ReadAllBytes(file);
    Console.WriteLine("FILE " + file);
    if (file.EndsWith(".ybn"))
    {
        var asset = new YbnFile(); asset.Load(data);
        Console.WriteLine(YbnXml.GetXml(asset));
    }
    else if (file.EndsWith(".ydr"))
    {
        var asset = new YdrFile(); asset.Load(data);
        Console.WriteLine(YdrXml.GetXml(asset));
    }
    else if (file.EndsWith(".ytyp"))
    {
        var asset = new YtypFile(); asset.Load(data);
        Console.WriteLine(MetaXml.GetXml(asset.Meta));
    }
}
