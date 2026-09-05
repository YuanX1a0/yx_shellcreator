using System;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using CodeWalker.GameFiles;
using SharpDX;

static class VerifyKit
{
    public static void Verify(string root)
    {
        foreach (var name in new[]{"yx_door_wood","yx_door_modern"})
        {
            var door = new YdrFile(); door.Load(File.ReadAllBytes(Path.Combine(root,"stream",name+".ydr")));
            if (door.Drawable?.Bound == null) throw new Exception(name+": missing embedded door bounds");
            var ray = new Ray(new Vector3(0,1,1),-Vector3.UnitY);
            var hit = door.Drawable.Bound.RayIntersect(ref ray);
            if (!hit.Hit || hit.HitDist > 1 || hit.HitDist < 0.8f) throw new Exception(name+": door panel has no collision");
            var archetype = new YtypFile(); archetype.Load(File.ReadAllBytes(Path.Combine(root,"stream",name+".ytyp")));
            if (archetype.AllArchetypes?.Length != 1) throw new Exception(name+": invalid door archetype");
            Console.WriteLine("PASS "+name+": embedded door panel collision and archetype round-trip");
        }
        var models = new[]{"yx_stairs_oak","yx_stairs_concrete","yx_stairs_collision","yx_spiral_oak","yx_spiral_concrete","yx_spiral_collision"};
        int probes = 0;
        foreach (var model in models)
        {
            var file = new YdrFile(); file.Load(File.ReadAllBytes(Path.Combine(root,"stream",model+".ydr")));
            if (file.Drawable?.Bound == null) throw new Exception(model+": missing embedded bounds");
            var ybn = new YbnFile(); ybn.Load(File.ReadAllBytes(Path.Combine(root,"stream",model+"_col.ybn")));
            var ytyp = new YtypFile(); ytyp.Load(File.ReadAllBytes(Path.Combine(root,"stream",model+".ytyp")));
            if (ytyp.AllArchetypes?.Length != 1) throw new Exception(model+": invalid archetype");
            var xml = XElement.Parse(YbnXml.GetXml(ybn));
            if (!xml.Descendants("Flags").Any(x => x.Value.Contains("FLAG_STAIRS"))) throw new Exception(model+": no stair material");
            bool spiral = model.StartsWith("yx_spiral_");
            bool ramp = model.EndsWith("collision");
            // Test the actual serialized YDR and YBN, not just the input mesh.
            foreach (var bounds in new[]{file.Drawable.Bound, ybn.Bounds})
            for (int i=0; i<20; i++)
            foreach (var across in new[]{-0.5f,0f,0.5f})
            {
                var progress = (i+0.5)/20;
                var angle = progress * Math.PI*1.5;
                float x = spiral ? (float)((1.2+across)*Math.Cos(angle)) : across;
                float y = spiral ? (float)(-(1.2+across)*Math.Sin(angle)) : (float)(2.5-progress*5);
                var ray = new Ray(new Vector3(x,y,5),-Vector3.UnitZ);
                var hit = bounds.RayIntersect(ref ray);
                var expected = ramp ? progress*3 : (i+1)*0.15;
                var height = 5-hit.HitDist;
                if (!hit.Hit || Math.Abs(height-expected)>0.016 || hit.Normal.Z<0.5f)
                    throw new Exception($"{model}: invalid support at step {i}, lane {across}, hit={hit.Hit}, z={height}, want={expected}, normal={hit.Normal}");
                if ((hit.Material.Flags & EBoundMaterialFlags.FLAG_STAIRS)==0) throw new Exception(model+": ray hit lacks stair flag");
                probes++;
            }
            Console.WriteLine($"PASS {model}: model/archetype/bounds round-trip and 120 walking-surface samples");
        }
        Console.WriteLine($"PASS {probes} binary collision probes. In-game ped gait still requires FiveM testing.");
    }
}
