using System.Linq;
using YxShellCreator.Server.Models;

namespace YxShellCreator.Server.Services
{
    internal static class HousePassages
    {
        public static HouseAccessPoint Find(HouseRecord house, string id)
        {
            if (house == null) return null;
            if (string.IsNullOrEmpty(id) || id == "main") return new HouseAccessPoint {
                Id = "main", Label = "默认出入口", Entrance = house.Entrance, Exit = house.Exit
            };
            return house.AccessPoints?.FirstOrDefault(p => p != null && p.Id == id);
        }

        public static Transform Arrival(HouseRecord house, HouseAccessPoint point)
            => point == null ? null : point.Id == "main" ? house.Spawn : point.Exit;
    }
}
