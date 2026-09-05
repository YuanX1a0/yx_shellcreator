using CitizenFX.Core;
using CitizenFX.Core.Native;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using YxShellCreator.Server.Models;
using YxShellCreator.Server.Services;

namespace YxShellCreator.Server
{
    public sealed partial class Main : BaseScript
    {
        private const string Prefix = "yx_shellcreator";
        private static readonly Regex SlugPattern = new Regex("^[a-z0-9][a-z0-9_-]{1,49}$", RegexOptions.Compiled);
        private static readonly Regex ModelPattern = new Regex("^[A-Za-z0-9_]{1,100}$", RegexOptions.Compiled);

        private readonly ResourceConfig _config;
        private readonly OxMySqlAdapter _database;
        private readonly Dictionary<string, HouseRecord> _houses = new Dictionary<string, HouseRecord>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, PlayerInteriorContext> _playerContexts = new Dictionary<string, PlayerInteriorContext>(StringComparer.OrdinalIgnoreCase);
        private readonly SemaphoreSlim _mutationLock = new SemaphoreSlim(1, 1);
        private bool _ready;
        private int _nextBucket;

        public Main()
        {
            JsonConvert.DefaultSettings = () => new JsonSerializerSettings
            {
                ContractResolver = new CamelCasePropertyNamesContractResolver(),
                NullValueHandling = NullValueHandling.Ignore
            };

            _config = LoadConfig();
            _database = new OxMySqlAdapter(Exports);
            _nextBucket = Math.Max(1, _config.BucketBase);

            EventHandlers[Prefix + ":server:requestState"] += new Action<Player, string>(OnRequestState);
            EventHandlers[Prefix + ":server:createHouse"] += new Action<Player, string>(OnCreateHouse);
            EventHandlers[Prefix + ":server:updateHouse"] += new Action<Player, string>(OnUpdateHouse);
            EventHandlers[Prefix + ":server:deleteHouse"] += new Action<Player, string>(OnDeleteHouse);
            EventHandlers[Prefix + ":server:enterHouse"] += new Action<Player, string>(OnEnterHouse);
            EventHandlers[Prefix + ":server:leaveHouse"] += new Action<Player, string>(OnLeaveHouse);
            EventHandlers[Prefix + ":server:fixLocation"] += new Action<Player, string>(OnFixLocation);
            EventHandlers[Prefix + ":server:setInteriorPoint"] += new Action<Player, string>(OnSetInteriorPoint);
            EventHandlers[Prefix + ":server:createObject"] += new Action<Player, string>(OnCreateObject);
            EventHandlers[Prefix + ":server:createNativeObject"] += new Action<Player, string>(OnCreateNativeObject);
            EventHandlers[Prefix + ":server:updateObject"] += new Action<Player, string>(OnUpdateObject);
            EventHandlers[Prefix + ":server:deleteObject"] += new Action<Player, string>(OnDeleteObject);
            EventHandlers[Prefix + ":server:restoreObject"] += new Action<Player, string>(OnRestoreObject);
            EventHandlers[Prefix + ":server:setDoorState"] += new Action<Player, string>(OnSetDoorState);
            EventHandlers[Prefix + ":server:setEnvironment"] += new Action<Player, string>(OnSetEnvironment);
            EventHandlers[Prefix + ":server:exportHouse"] += new Action<Player, string>(OnExportHouse);
            EventHandlers[Prefix + ":server:importHouse"] += new Action<Player, string>(OnImportHouse);
            EventHandlers[Prefix + ":server:accessPoint"] += new Action<Player, string>(OnAccessPoint);
            EventHandlers[Prefix + ":server:pushDoor"] += new Action<Player, string>(OnPushDoor);
            EventHandlers["playerDropped"] += new Action<string, string>(OnPlayerDropped);
            EventHandlers["onResourceStop"] += new Action<string>(OnResourceStop);

            Tick += BootstrapTick;
        }

        private async Task BootstrapTick()
        {
            Tick -= BootstrapTick;
            await Delay(0);
            await InitializeAsync();
        }

        private async Task InitializeAsync()
        {
            try
            {
                Exception lastConnectionError = null;
                var connected = false;
                for (var attempt = 1; attempt <= 30; attempt++)
                {
                    if (_database.IsAvailable)
                    {
                        try
                        {
                            await _database.ExecuteAsync("SELECT 1 AS `yx_shellcreator_ready`");
                            connected = true;
                            break;
                        }
                        catch (Exception ex)
                        {
                            lastConnectionError = ex;
                        }
                    }

                    await Delay(500);
                }

                if (!connected)
                    throw new InvalidOperationException("oxmysql did not become ready within 15 seconds", lastConnectionError);

                await _database.ExecuteAsync(@"
CREATE TABLE IF NOT EXISTS `yx_shellcreator_houses` (
    `id` CHAR(36) NOT NULL,
    `slug` VARCHAR(50) NOT NULL,
    `label` VARCHAR(80) NOT NULL,
    `preset_id` VARCHAR(50) NOT NULL,
    `shell_model` VARCHAR(100) NULL DEFAULT NULL,
    `bucket` INT NOT NULL,
    `environment_json` TEXT NULL,
    `access_points_json` TEXT NULL,
    `entrance_x` DOUBLE NOT NULL,
    `entrance_y` DOUBLE NOT NULL,
    `entrance_z` DOUBLE NOT NULL,
    `entrance_h` DOUBLE NOT NULL DEFAULT 0,
    `spawn_x` DOUBLE NOT NULL,
    `spawn_y` DOUBLE NOT NULL,
    `spawn_z` DOUBLE NOT NULL,
    `spawn_h` DOUBLE NOT NULL DEFAULT 0,
    `exit_x` DOUBLE NOT NULL,
    `exit_y` DOUBLE NOT NULL,
    `exit_z` DOUBLE NOT NULL,
    `exit_h` DOUBLE NOT NULL DEFAULT 0,
    `created_by` VARCHAR(80) NULL DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_yx_shellcreator_slug` (`slug`),
    UNIQUE KEY `uq_yx_shellcreator_bucket` (`bucket`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;");

                await _database.ExecuteAsync(@"
CREATE TABLE IF NOT EXISTS `yx_shellcreator_objects` (
    `id` CHAR(36) NOT NULL,
    `house_id` CHAR(36) NOT NULL,
    `model` VARCHAR(100) NOT NULL,
    `pos_x` DOUBLE NOT NULL,
    `pos_y` DOUBLE NOT NULL,
    `pos_z` DOUBLE NOT NULL,
    `rot_x` DOUBLE NOT NULL DEFAULT 0,
    `rot_y` DOUBLE NOT NULL DEFAULT 0,
    `rot_z` DOUBLE NOT NULL DEFAULT 0,
    `source_kind` VARCHAR(16) NOT NULL DEFAULT 'placed',
    `source_model_hash` BIGINT UNSIGNED NULL DEFAULT NULL,
    `source_pos_x` DOUBLE NULL DEFAULT NULL,
    `source_pos_y` DOUBLE NULL DEFAULT NULL,
    `source_pos_z` DOUBLE NULL DEFAULT NULL,
    `hidden` TINYINT(1) NOT NULL DEFAULT 0,
    `door_open` TINYINT(1) NOT NULL DEFAULT 0,
    `created_by` VARCHAR(80) NULL DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_yx_shellcreator_objects_house` (`house_id`),
    CONSTRAINT `fk_yx_shellcreator_objects_house`
        FOREIGN KEY (`house_id`) REFERENCES `yx_shellcreator_houses` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;");

                await EnsureObjectMetadataSchemaAsync();
                await EnsureHouseEnvironmentSchemaAsync();
                await EnsurePassagesSchemaAsync();

                await LoadHousesAsync();
                _ready = true;
                Debug.WriteLine("[yx_shellcreator] Ready. Loaded " + _houses.Count + " houses. Everyone can create and manage houses.");
                BroadcastHouses();
            }
            catch (Exception ex)
            {
                _ready = false;
                Debug.WriteLine("[yx_shellcreator] Database initialization failed: " + ex);
            }
        }

        private async Task EnsureObjectMetadataSchemaAsync()
        {
            var rows = await _database.QueryRowsAsync(@"
SELECT LOWER(`COLUMN_NAME`) AS `column_name`
FROM `INFORMATION_SCHEMA`.`COLUMNS`
WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'yx_shellcreator_objects'");
            var columns = new HashSet<string>(
                rows.Select(row => ReadString(row, "column_name")).Where(value => !string.IsNullOrWhiteSpace(value)),
                StringComparer.OrdinalIgnoreCase);
            var additions = new List<KeyValuePair<string, string>>
            {
                new KeyValuePair<string, string>("source_kind", "ALTER TABLE `yx_shellcreator_objects` ADD COLUMN `source_kind` VARCHAR(16) NOT NULL DEFAULT 'placed' AFTER `rot_z`"),
                new KeyValuePair<string, string>("source_model_hash", "ALTER TABLE `yx_shellcreator_objects` ADD COLUMN `source_model_hash` BIGINT UNSIGNED NULL DEFAULT NULL AFTER `source_kind`"),
                new KeyValuePair<string, string>("source_pos_x", "ALTER TABLE `yx_shellcreator_objects` ADD COLUMN `source_pos_x` DOUBLE NULL DEFAULT NULL AFTER `source_model_hash`"),
                new KeyValuePair<string, string>("source_pos_y", "ALTER TABLE `yx_shellcreator_objects` ADD COLUMN `source_pos_y` DOUBLE NULL DEFAULT NULL AFTER `source_pos_x`"),
                new KeyValuePair<string, string>("source_pos_z", "ALTER TABLE `yx_shellcreator_objects` ADD COLUMN `source_pos_z` DOUBLE NULL DEFAULT NULL AFTER `source_pos_y`"),
                new KeyValuePair<string, string>("hidden", "ALTER TABLE `yx_shellcreator_objects` ADD COLUMN `hidden` TINYINT(1) NOT NULL DEFAULT 0 AFTER `source_pos_z`"),
                new KeyValuePair<string, string>("door_open", "ALTER TABLE `yx_shellcreator_objects` ADD COLUMN `door_open` TINYINT(1) NOT NULL DEFAULT 0 AFTER `hidden`")
            };
            foreach (var addition in additions)
            {
                if (!columns.Contains(addition.Key)) await _database.ExecuteAsync(addition.Value);
            }
        }

        private async Task LoadHousesAsync()
        {
            var rows = await _database.QueryRowsAsync("SELECT * FROM `yx_shellcreator_houses` ORDER BY `created_at` ASC");
            _houses.Clear();
            var highestBucket = _config.BucketBase - 1;

            foreach (var row in rows)
            {
                var house = HouseFromRow(row);
                if (house == null) continue;
                _houses[house.Id] = house;
                highestBucket = Math.Max(highestBucket, house.Bucket);
                API.SetRoutingBucketPopulationEnabled(house.Bucket, false);
            }

            _nextBucket = Math.Max(_config.BucketBase, highestBucket + 1);
        }

        private void OnRequestState([FromSource] Player source, string payload)
        {
            var request = Parse<RequestBase>(payload);
            if (!EnsureReady(source, request == null ? null : request.RequestId)) return;
            Respond(source, request == null ? null : request.RequestId, true, SnapshotHouses(), null);
        }

        private void OnCreateHouse([FromSource] Player source, string payload)
        {
            RunSafe(source, Parse<CreateHouseRequest>(payload), HandleCreateHouseAsync);
        }

        private async Task HandleCreateHouseAsync(Player source, CreateHouseRequest request)
        {
            var validation = ValidateCreateHouse(request);
            if (validation != null)
            {
                Respond(source, RequestId(request), false, null, validation);
                return;
            }

            await _mutationLock.WaitAsync();
            try
            {
                if (_houses.Values.Any(x => string.Equals(x.Slug, request.Slug, StringComparison.OrdinalIgnoreCase)))
                {
                    Respond(source, request.RequestId, false, null, "房屋 ID 已存在");
                    return;
                }

                var preset = FindPreset(request.PresetId);
                var currentLocationPreset = IsCurrentLocationPreset(preset);
                var house = new HouseRecord
                {
                    Id = Guid.NewGuid().ToString(),
                    Slug = request.Slug.ToLowerInvariant(),
                    Label = NormalizeLabel(request.Label),
                    PresetId = preset.Id,
                    ShellModel = string.Equals(preset.Type, "shell", StringComparison.OrdinalIgnoreCase)
                        ? request.ShellModel.Trim()
                        : null,
                    Bucket = _nextBucket++,
                    Entrance = CopyTransform(request.Entrance),
                    Spawn = CopyTransform(currentLocationPreset ? request.Entrance : preset.Spawn),
                    Exit = CopyTransform(currentLocationPreset ? request.Entrance : preset.Exit)
                };

                await _database.ExecuteAsync(@"
INSERT INTO `yx_shellcreator_houses`
(`id`, `slug`, `label`, `preset_id`, `shell_model`, `bucket`,
 `entrance_x`, `entrance_y`, `entrance_z`, `entrance_h`,
 `spawn_x`, `spawn_y`, `spawn_z`, `spawn_h`,
 `exit_x`, `exit_y`, `exit_z`, `exit_h`, `created_by`)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", new object[]
                {
                    house.Id, house.Slug, house.Label, house.PresetId, house.ShellModel, house.Bucket,
                    house.Entrance.X, house.Entrance.Y, house.Entrance.Z, house.Entrance.H,
                    house.Spawn.X, house.Spawn.Y, house.Spawn.Z, house.Spawn.H,
                    house.Exit.X, house.Exit.Y, house.Exit.Z, house.Exit.H, PlayerIdentifier(source)
                });

                _houses[house.Id] = house;
                API.SetRoutingBucketPopulationEnabled(house.Bucket, false);
                BroadcastHouses();
                Respond(source, request.RequestId, true, house, "房屋已创建");
            }
            finally
            {
                _mutationLock.Release();
            }
        }

        private void OnUpdateHouse([FromSource] Player source, string payload)
        {
            RunSafe(source, Parse<UpdateHouseRequest>(payload), HandleUpdateHouseAsync);
        }

        private async Task HandleUpdateHouseAsync(Player source, UpdateHouseRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.HouseId) || !_houses.TryGetValue(request.HouseId, out var house))
            {
                Respond(source, RequestId(request), false, null, "房屋不存在");
                return;
            }

            if (string.IsNullOrWhiteSpace(request.Label) || request.Label.Trim().Length > 80 || !ValidWorldTransform(request.Entrance))
            {
                Respond(source, request.RequestId, false, null, "房屋名称或入口坐标无效");
                return;
            }

            var preset = FindPreset(request.PresetId);
            if (preset == null)
            {
                Respond(source, request.RequestId, false, null, "室内模板不存在");
                return;
            }

            var shellModel = string.Equals(preset.Type, "shell", StringComparison.OrdinalIgnoreCase)
                ? (request.ShellModel ?? string.Empty).Trim()
                : null;
            if (string.Equals(preset.Type, "shell", StringComparison.OrdinalIgnoreCase) && !ModelPattern.IsMatch(shellModel))
            {
                Respond(source, request.RequestId, false, null, "自定义 Shell 模型名无效");
                return;
            }

            await _mutationLock.WaitAsync();
            try
            {
                var presetChanged = !string.Equals(house.PresetId, preset.Id, StringComparison.OrdinalIgnoreCase)
                    || !string.Equals(house.ShellModel ?? string.Empty, shellModel ?? string.Empty, StringComparison.OrdinalIgnoreCase);

                house.Label = NormalizeLabel(request.Label);
                house.Entrance = CopyTransform(request.Entrance);
                house.PresetId = preset.Id;
                house.ShellModel = shellModel;
                if (presetChanged)
                {
                    var capturedLocation = ValidWorldTransform(request.CurrentPosition)
                        ? request.CurrentPosition
                        : request.Entrance;
                    var presetLocation = IsCurrentLocationPreset(preset) ? capturedLocation : preset.Spawn;
                    house.Spawn = CopyTransform(presetLocation);
                    house.Exit = CopyTransform(IsCurrentLocationPreset(preset) ? capturedLocation : preset.Exit);
                }

                await _database.ExecuteAsync(@"
UPDATE `yx_shellcreator_houses`
SET `label` = ?, `preset_id` = ?, `shell_model` = ?,
    `entrance_x` = ?, `entrance_y` = ?, `entrance_z` = ?, `entrance_h` = ?,
    `spawn_x` = ?, `spawn_y` = ?, `spawn_z` = ?, `spawn_h` = ?,
    `exit_x` = ?, `exit_y` = ?, `exit_z` = ?, `exit_h` = ?
WHERE `id` = ?", new object[]
                {
                    house.Label, house.PresetId, house.ShellModel,
                    house.Entrance.X, house.Entrance.Y, house.Entrance.Z, house.Entrance.H,
                    house.Spawn.X, house.Spawn.Y, house.Spawn.Z, house.Spawn.H,
                    house.Exit.X, house.Exit.Y, house.Exit.Z, house.Exit.H,
                    house.Id
                });

                BroadcastHouses();
                BroadcastHouseUpdate(house);
                Respond(source, request.RequestId, true, house, "房屋已更新");
            }
            finally
            {
                _mutationLock.Release();
            }
        }

        private void OnDeleteHouse([FromSource] Player source, string payload)
        {
            RunSafe(source, Parse<HouseIdRequest>(payload), HandleDeleteHouseAsync);
        }

        private async Task HandleDeleteHouseAsync(Player source, HouseIdRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.HouseId) || !_houses.TryGetValue(request.HouseId, out var house))
            {
                Respond(source, RequestId(request), false, null, "房屋不存在");
                return;
            }

            await _mutationLock.WaitAsync();
            try
            {
                foreach (var player in Players.ToList())
                {
                    if (_playerContexts.TryGetValue(player.Handle, out var context))
                    {
                        var deletedContext = FindContext(context, house.Id);
                        if (deletedContext != null)
                            await EvictDeletedHouseAsync(player, context, deletedContext, house.Entrance);
                    }
                }

                await _database.ExecuteAsync("DELETE FROM `yx_shellcreator_houses` WHERE `id` = ?", new object[] { house.Id });
                _houses.Remove(house.Id);
                BroadcastHouses();
                Respond(source, request.RequestId, true, new { houseId = house.Id }, "房屋及其建筑物已删除");
            }
            finally
            {
                _mutationLock.Release();
            }
        }

        private void OnEnterHouse([FromSource] Player source, string payload)
        {
            RunSafe(source, Parse<PassageRequest>(payload), HandleEnterHouseAsync);
        }

        private async Task HandleEnterHouseAsync(Player source, PassageRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.HouseId) || !_houses.TryGetValue(request.HouseId, out var house))
            {
                Respond(source, RequestId(request), false, null, "房屋不存在");
                return;
            }

            var access = FindAccessPoint(house, request.PointId);
            if (access == null) { Respond(source, request.RequestId, false, null, "出入口不存在"); return; }
            var destination = HousePassages.Arrival(house, access);
            var objects = await LoadObjectsAsync(house.Id);
            _playerContexts.TryGetValue(source.Handle, out var previous);
            if (previous != null && string.Equals(previous.HouseId, house.Id, StringComparison.OrdinalIgnoreCase))
            {
                API.SetRoutingBucketPopulationEnabled(house.Bucket, false);
                API.SetPlayerRoutingBucket(source.Handle, house.Bucket);
                var currentResult = new EnterPayload
                {
                    House = house,
                    Objects = objects,
                    Teleport = CopyTransform(destination),
                    Depth = ContextDepth(previous)
                };
                source.TriggerEvent(Prefix + ":client:entered", JsonConvert.SerializeObject(currentResult));
                Respond(source, request.RequestId, true, currentResult, null);
                return;
            }

            if (previous != null && ContextDepth(previous) >= 16)
            {
                Respond(source, request.RequestId, false, null, "房屋嵌套层数已达到上限");
                return;
            }

            var originalBucket = previous == null
                ? API.GetPlayerRoutingBucket(source.Handle)
                : previous.OriginalBucket;

            API.SetRoutingBucketPopulationEnabled(house.Bucket, false);
            API.SetPlayerRoutingBucket(source.Handle, house.Bucket);
            _playerContexts[source.Handle] = new PlayerInteriorContext
            {
                HouseId = house.Id,
                OriginalBucket = originalBucket,
                ReturnPosition = CopyTransform(access.Entrance),
                EntryPointId = access.Id,
                Previous = previous
            };

            var result = new EnterPayload
            {
                House = house,
                Objects = objects,
                Teleport = CopyTransform(destination),
                Depth = ContextDepth(_playerContexts[source.Handle])
            };
            source.TriggerEvent(Prefix + ":client:entered", JsonConvert.SerializeObject(result));
            Respond(source, request.RequestId, true, result, null);
        }

        private void OnLeaveHouse([FromSource] Player source, string payload)
        {
            RunSafe(source, Parse<PassageRequest>(payload), HandleLeaveHouseAsync);
        }

        private async Task HandleLeaveHouseAsync(Player source, PassageRequest request)
        {
            if (source == null || !_playerContexts.TryGetValue(source.Handle, out var context)
                || !_houses.TryGetValue(context.HouseId, out var house))
            {
                Respond(source, RequestId(request), false, null, "你当前不在房屋内");
                return;
            }

            if (!string.IsNullOrEmpty(request.PointId))
            {
                var access = FindAccessPoint(house, request.PointId);
                if (access == null) { Respond(source, request.RequestId, false, null, "出入口不存在"); return; }
                context.ReturnPosition = CopyTransform(access.Entrance);
            }
            await LeaveInteriorAsync(source, false, house.Entrance);
            Respond(source, RequestId(request), true, null, null);
        }

        private async Task LeaveInteriorAsync(Player player, bool forced, Transform entrance)
        {
            if (player == null || !_playerContexts.TryGetValue(player.Handle, out var context)) return;

            var previous = context.Previous;
            while (previous != null && !_houses.ContainsKey(previous.HouseId)) previous = previous.Previous;
            if (previous != null && _houses.TryGetValue(previous.HouseId, out var previousHouse))
            {
                _playerContexts[player.Handle] = previous;
                API.SetRoutingBucketPopulationEnabled(previousHouse.Bucket, false);
                API.SetPlayerRoutingBucket(player.Handle, previousHouse.Bucket);
                var objects = await LoadObjectsAsync(previousHouse.Id);
                var directParent = ReferenceEquals(previous, context.Previous);
                var result = new EnterPayload
                {
                    House = previousHouse,
                    Objects = objects,
                    Teleport = directParent && context.ReturnPosition != null
                        ? CopyTransform(context.ReturnPosition)
                        : CopyTransform(previousHouse.Exit ?? previousHouse.Spawn),
                    Resumed = true,
                    Depth = ContextDepth(previous)
                };
                player.TriggerEvent(Prefix + ":client:entered", JsonConvert.SerializeObject(result));
                return;
            }

            _playerContexts.Remove(player.Handle);
            API.SetPlayerRoutingBucket(player.Handle, context.OriginalBucket);
            player.TriggerEvent(Prefix + ":client:left", JsonConvert.SerializeObject(new
            {
                forced,
                entrance = context.ReturnPosition ?? entrance ?? new Transform()
            }));
        }

        private async Task EvictDeletedHouseAsync(
            Player player,
            PlayerInteriorContext current,
            PlayerInteriorContext deleted,
            Transform fallbackEntrance)
        {
            var destination = deleted.Previous;
            while (destination != null && !_houses.ContainsKey(destination.HouseId)) destination = destination.Previous;
            if (destination != null && _houses.TryGetValue(destination.HouseId, out var destinationHouse))
            {
                _playerContexts[player.Handle] = destination;
                API.SetRoutingBucketPopulationEnabled(destinationHouse.Bucket, false);
                API.SetPlayerRoutingBucket(player.Handle, destinationHouse.Bucket);
                var objects = await LoadObjectsAsync(destinationHouse.Id);
                var result = new EnterPayload
                {
                    House = destinationHouse,
                    Objects = objects,
                    Teleport = deleted.ReturnPosition != null
                        ? CopyTransform(deleted.ReturnPosition)
                        : CopyTransform(destinationHouse.Exit ?? destinationHouse.Spawn),
                    Resumed = true,
                    Depth = ContextDepth(destination)
                };
                player.TriggerEvent(Prefix + ":client:entered", JsonConvert.SerializeObject(result));
                return;
            }

            _playerContexts.Remove(player.Handle);
            API.SetPlayerRoutingBucket(player.Handle, current.OriginalBucket);
            player.TriggerEvent(Prefix + ":client:left", JsonConvert.SerializeObject(new
            {
                forced = true,
                entrance = deleted.ReturnPosition ?? fallbackEntrance ?? new Transform()
            }));
        }

        private void OnFixLocation([FromSource] Player source, string payload)
        {
            RunSafe(source, Parse<RequestBase>(payload), HandleFixLocationAsync);
        }

        private async Task HandleFixLocationAsync(Player source, RequestBase request)
        {
            if (source == null || !_playerContexts.TryGetValue(source.Handle, out var context)
                || !_houses.TryGetValue(context.HouseId, out var house))
            {
                Respond(source, RequestId(request), false, null, "你当前不在房屋内");
                return;
            }

            API.SetRoutingBucketPopulationEnabled(house.Bucket, false);
            API.SetPlayerRoutingBucket(source.Handle, house.Bucket);
            var objects = await LoadObjectsAsync(house.Id);
            var result = new EnterPayload
            {
                House = house,
                Objects = objects,
                Teleport = CopyTransform(FindAccessPoint(house, context.EntryPointId)?.Exit ?? house.Exit ?? house.Spawn),
                Recovery = true,
                Depth = ContextDepth(context)
            };
            source.TriggerEvent(Prefix + ":client:entered", JsonConvert.SerializeObject(result));
            Respond(source, request.RequestId, true, new { houseId = house.Id }, null);
        }

        private void OnSetInteriorPoint([FromSource] Player source, string payload)
        {
            RunSafe(source, Parse<UpdateInteriorPointRequest>(payload), HandleSetInteriorPointAsync);
        }

        private async Task HandleSetInteriorPointAsync(Player source, UpdateInteriorPointRequest request)
        {
            if (!CanBuild(source, request == null ? null : request.HouseId, out var house))
            {
                Respond(source, RequestId(request), false, null, "请先进入该房屋");
                return;
            }

            if (request.Transform == null || !ValidInteriorTransform(request.Transform, house) || (request.Kind != "spawn" && request.Kind != "exit"))
            {
                Respond(source, request.RequestId, false, null, "室内坐标无效");
                return;
            }

            var point = CopyTransform(request.Transform);
            if (request.Kind == "spawn") house.Spawn = point;
            else house.Exit = point;

            var prefix = request.Kind == "spawn" ? "spawn" : "exit";
            await _database.ExecuteAsync(
                "UPDATE `yx_shellcreator_houses` SET `" + prefix + "_x` = ?, `" + prefix + "_y` = ?, `" + prefix + "_z` = ?, `" + prefix + "_h` = ? WHERE `id` = ?",
                new object[] { point.X, point.Y, point.Z, point.H, house.Id });

            BroadcastHouses();
            BroadcastHouseUpdate(house);
            Respond(source, request.RequestId, true, house, request.Kind == "spawn" ? "出生点已设置" : "出口点已设置");
        }

        private void OnCreateObject([FromSource] Player source, string payload)
        {
            RunSafe(source, Parse<CreateObjectRequest>(payload), HandleCreateObjectAsync);
        }

        private async Task HandleCreateObjectAsync(Player source, CreateObjectRequest request)
        {
            if (!CanBuild(source, request == null ? null : request.HouseId, out var house))
            {
                Respond(source, RequestId(request), false, null, "请先进入该房屋");
                return;
            }

            if (!ModelPattern.IsMatch((request.Model ?? string.Empty).Trim())
                || request.Position == null || request.Rotation == null
                || !ValidInteriorTransform(request.Position, house) || !ValidRotation(request.Rotation))
            {
                Respond(source, request.RequestId, false, null, "模型或坐标无效");
                return;
            }

            var countRows = await _database.QueryRowsAsync(
                "SELECT COUNT(*) AS `total` FROM `yx_shellcreator_objects` WHERE `house_id` = ?",
                new object[] { house.Id });
            var total = countRows.Count == 0 ? 0 : ReadInt(countRows[0], "total");
            if (total >= _config.MaxObjectsPerHouse)
            {
                Respond(source, request.RequestId, false, null, "该房屋已达到物件数量上限");
                return;
            }

            var item = new DecorationRecord
            {
                Id = Guid.NewGuid().ToString(),
                HouseId = house.Id,
                Model = request.Model.Trim(),
                Position = CopyTransform(request.Position),
                Rotation = CopyRotation(request.Rotation)
            };

            await _database.ExecuteAsync(@"
INSERT INTO `yx_shellcreator_objects`
(`id`, `house_id`, `model`, `pos_x`, `pos_y`, `pos_z`, `rot_x`, `rot_y`, `rot_z`, `created_by`)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", new object[]
            {
                item.Id, item.HouseId, item.Model,
                item.Position.X, item.Position.Y, item.Position.Z,
                item.Rotation.X, item.Rotation.Y, item.Rotation.Z,
                PlayerIdentifier(source)
            });

            BroadcastToHouse(house.Id, Prefix + ":client:objectCreated", item);
            Respond(source, request.RequestId, true, item, "物件已放置");
        }

        private void OnCreateNativeObject([FromSource] Player source, string payload)
        {
            RunSafe(source, Parse<CreateNativeObjectRequest>(payload), HandleCreateNativeObjectAsync);
        }

        private async Task HandleCreateNativeObjectAsync(Player source, CreateNativeObjectRequest request)
        {
            if (!CanBuild(source, request == null ? null : request.HouseId, out var house))
            {
                Respond(source, RequestId(request), false, null, "请先进入该房屋");
                return;
            }

            if (!ModelPattern.IsMatch((request.Model ?? string.Empty).Trim())
                || request.SourceModelHash <= 0 || request.SourceModelHash > uint.MaxValue
                || request.SourcePosition == null || request.Position == null || request.Rotation == null
                || !ValidInteriorTransform(request.SourcePosition, house)
                || !ValidInteriorTransform(request.Position, house) || !ValidRotation(request.Rotation))
            {
                Respond(source, request.RequestId, false, null, "原生室内物件数据无效");
                return;
            }

            var existingRows = await _database.QueryRowsAsync(@"
SELECT * FROM `yx_shellcreator_objects`
WHERE `house_id` = ? AND `source_kind` = 'native' AND `source_model_hash` = ?
  AND ABS(`source_pos_x` - ?) < 0.05
  AND ABS(`source_pos_y` - ?) < 0.05
  AND ABS(`source_pos_z` - ?) < 0.05
LIMIT 1", new object[]
            {
                house.Id, request.SourceModelHash,
                request.SourcePosition.X, request.SourcePosition.Y, request.SourcePosition.Z
            });
            if (existingRows.Count > 0)
            {
                var existing = ObjectFromRow(existingRows[0]);
                Respond(source, request.RequestId, true, existing, "该原生物件已经可以编辑");
                return;
            }

            var countRows = await _database.QueryRowsAsync(
                "SELECT COUNT(*) AS `total` FROM `yx_shellcreator_objects` WHERE `house_id` = ?",
                new object[] { house.Id });
            var total = countRows.Count == 0 ? 0 : ReadInt(countRows[0], "total");
            if (total >= _config.MaxObjectsPerHouse)
            {
                Respond(source, request.RequestId, false, null, "该房屋已达到物件数量上限");
                return;
            }

            var item = new DecorationRecord
            {
                Id = Guid.NewGuid().ToString(),
                HouseId = house.Id,
                Model = request.Model.Trim(),
                Position = CopyTransform(request.Position),
                Rotation = CopyRotation(request.Rotation),
                SourceKind = "native",
                SourceModelHash = request.SourceModelHash,
                SourcePosition = CopyTransform(request.SourcePosition),
                Hidden = false
            };

            await _database.ExecuteAsync(@"
INSERT INTO `yx_shellcreator_objects`
(`id`, `house_id`, `model`, `pos_x`, `pos_y`, `pos_z`, `rot_x`, `rot_y`, `rot_z`,
 `source_kind`, `source_model_hash`, `source_pos_x`, `source_pos_y`, `source_pos_z`, `hidden`, `created_by`)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'native', ?, ?, ?, ?, 0, ?)", new object[]
            {
                item.Id, item.HouseId, item.Model,
                item.Position.X, item.Position.Y, item.Position.Z,
                item.Rotation.X, item.Rotation.Y, item.Rotation.Z,
                item.SourceModelHash,
                item.SourcePosition.X, item.SourcePosition.Y, item.SourcePosition.Z,
                PlayerIdentifier(source)
            });

            BroadcastToHouse(house.Id, Prefix + ":client:objectCreated", item);
            Respond(source, request.RequestId, true, item, "原生室内物件已接管");
        }

        private void OnUpdateObject([FromSource] Player source, string payload)
        {
            RunSafe(source, Parse<UpdateObjectRequest>(payload), HandleUpdateObjectAsync);
        }

        private async Task HandleUpdateObjectAsync(Player source, UpdateObjectRequest request)
        {
            if (!CanBuild(source, request == null ? null : request.HouseId, out var house))
            {
                Respond(source, RequestId(request), false, null, "请先进入该房屋");
                return;
            }

            if (string.IsNullOrWhiteSpace(request.ObjectId) || request.Position == null || request.Rotation == null
                || !ValidInteriorTransform(request.Position, house) || !ValidRotation(request.Rotation))
            {
                Respond(source, request.RequestId, false, null, "物件坐标无效");
                return;
            }

            var exists = await ObjectExistsAsync(request.ObjectId, house.Id);
            if (!exists)
            {
                Respond(source, request.RequestId, false, null, "物件不存在");
                return;
            }

            var item = new DecorationRecord
            {
                Id = request.ObjectId,
                HouseId = house.Id,
                Position = CopyTransform(request.Position),
                Rotation = CopyRotation(request.Rotation)
            };

            await _database.ExecuteAsync(@"
UPDATE `yx_shellcreator_objects`
SET `pos_x` = ?, `pos_y` = ?, `pos_z` = ?, `rot_x` = ?, `rot_y` = ?, `rot_z` = ?
WHERE `id` = ? AND `house_id` = ?", new object[]
            {
                item.Position.X, item.Position.Y, item.Position.Z,
                item.Rotation.X, item.Rotation.Y, item.Rotation.Z,
                item.Id, item.HouseId
            });

            BroadcastToHouse(house.Id, Prefix + ":client:objectUpdated", item);
            Respond(source, request.RequestId, true, item, null);
        }

        private void OnDeleteObject([FromSource] Player source, string payload)
        {
            RunSafe(source, Parse<DeleteObjectRequest>(payload), HandleDeleteObjectAsync);
        }

        private async Task HandleDeleteObjectAsync(Player source, DeleteObjectRequest request)
        {
            if (!CanBuild(source, request == null ? null : request.HouseId, out var house))
            {
                Respond(source, RequestId(request), false, null, "请先进入该房屋");
                return;
            }

            var item = string.IsNullOrWhiteSpace(request.ObjectId)
                ? null
                : await LoadObjectAsync(request.ObjectId, house.Id);
            if (item == null)
            {
                Respond(source, request == null ? null : request.RequestId, false, null, "物件不存在");
                return;
            }

            if (string.Equals(item.SourceKind, "native", StringComparison.OrdinalIgnoreCase))
            {
                await _database.ExecuteAsync(
                    "UPDATE `yx_shellcreator_objects` SET `hidden` = 1 WHERE `id` = ? AND `house_id` = ?",
                    new object[] { request.ObjectId, house.Id });
                var hiddenData = new { houseId = house.Id, objectId = request.ObjectId, native = true };
                BroadcastToHouse(house.Id, Prefix + ":client:objectDeleted", hiddenData);
                Respond(source, request.RequestId, true, hiddenData, "原生物件已隐藏");
                return;
            }

            await _database.ExecuteAsync(
                "DELETE FROM `yx_shellcreator_objects` WHERE `id` = ? AND `house_id` = ?",
                new object[] { request.ObjectId, house.Id });

            var data = new { houseId = house.Id, objectId = request.ObjectId };
            BroadcastToHouse(house.Id, Prefix + ":client:objectDeleted", data);
            Respond(source, request.RequestId, true, data, "物件已删除");
        }

        private void OnRestoreObject([FromSource] Player source, string payload)
        {
            RunSafe(source, Parse<DeleteObjectRequest>(payload), HandleRestoreObjectAsync);
        }

        private async Task HandleRestoreObjectAsync(Player source, DeleteObjectRequest request)
        {
            if (!CanBuild(source, request == null ? null : request.HouseId, out var house))
            {
                Respond(source, RequestId(request), false, null, "请先进入该房屋");
                return;
            }
            var item = string.IsNullOrWhiteSpace(request.ObjectId)
                ? null
                : await LoadObjectAsync(request.ObjectId, house.Id);
            if (item == null || !string.Equals(item.SourceKind, "native", StringComparison.OrdinalIgnoreCase))
            {
                Respond(source, RequestId(request), false, null, "只能恢复已隐藏的原生物件");
                return;
            }
            item.Hidden = false;
            await _database.ExecuteAsync(
                "UPDATE `yx_shellcreator_objects` SET `hidden` = 0 WHERE `id` = ? AND `house_id` = ?",
                new object[] { item.Id, house.Id });
            BroadcastToHouse(house.Id, Prefix + ":client:objectRestored", item);
            Respond(source, request.RequestId, true, item, "原生物件已恢复");
        }

        private void OnSetDoorState([FromSource] Player source, string payload)
        {
            RunSafe(source, Parse<SetDoorStateRequest>(payload), HandleSetDoorStateAsync);
        }

        private async Task HandleSetDoorStateAsync(Player source, SetDoorStateRequest request)
        {
            if (!CanBuild(source, request == null ? null : request.HouseId, out var house))
            {
                Respond(source, RequestId(request), false, null, "请先进入该房屋");
                return;
            }
            var item = string.IsNullOrWhiteSpace(request.ObjectId)
                ? null
                : await LoadObjectAsync(request.ObjectId, house.Id);
            if (item == null || item.Hidden)
            {
                Respond(source, RequestId(request), false, null, "门物件不存在");
                return;
            }

            await _database.ExecuteAsync(
                "UPDATE `yx_shellcreator_objects` SET `door_open` = ? WHERE `id` = ? AND `house_id` = ?",
                new object[] { request.Open ? 1 : 0, item.Id, house.Id });
            var data = new { houseId = house.Id, objectId = item.Id, open = request.Open };
            BroadcastToHouse(house.Id, Prefix + ":client:doorState", data);
            Respond(source, request.RequestId, true, data, null);
        }

        private async Task<bool> ObjectExistsAsync(string objectId, string houseId)
        {
            var rows = await _database.QueryRowsAsync(
                "SELECT `id` FROM `yx_shellcreator_objects` WHERE `id` = ? AND `house_id` = ? LIMIT 1",
                new object[] { objectId, houseId });
            return rows.Count > 0;
        }

        private async Task<DecorationRecord> LoadObjectAsync(string objectId, string houseId)
        {
            var rows = await _database.QueryRowsAsync(
                "SELECT * FROM `yx_shellcreator_objects` WHERE `id` = ? AND `house_id` = ? LIMIT 1",
                new object[] { objectId, houseId });
            return rows.Count > 0 ? ObjectFromRow(rows[0]) : null;
        }

        private async Task<List<DecorationRecord>> LoadObjectsAsync(string houseId)
        {
            var rows = await _database.QueryRowsAsync(
                "SELECT * FROM `yx_shellcreator_objects` WHERE `house_id` = ? ORDER BY `created_at` ASC",
                new object[] { houseId });
            return rows.Select(ObjectFromRow).Where(x => x != null).ToList();
        }

        private void RunSafe<T>(Player source, T request, Func<Player, T, Task> handler) where T : RequestBase
        {
            if (!EnsureReady(source, RequestId(request))) return;
            if (request == null)
            {
                Respond(source, null, false, null, "请求数据无效");
                return;
            }

            _ = RunSafeAsync(source, request, handler);
        }

        private async Task RunSafeAsync<T>(Player source, T request, Func<Player, T, Task> handler) where T : RequestBase
        {
            try
            {
                await handler(source, request);
            }
            catch (Exception ex)
            {
                Debug.WriteLine("[yx_shellcreator] Request failed: " + ex);
                Respond(source, RequestId(request), false, null, "数据库操作失败，请查看服务端控制台");
            }
        }

        private bool EnsureReady(Player source, string requestId)
        {
            if (_ready) return true;
            Respond(source, requestId, false, null, "yx_shellcreator 数据库尚未就绪");
            return false;
        }

        private bool CanBuild(Player source, string houseId, out HouseRecord house)
        {
            house = null;
            if (source == null || string.IsNullOrWhiteSpace(houseId)) return false;
            if (!_playerContexts.TryGetValue(source.Handle, out var context)) return false;
            if (!string.Equals(context.HouseId, houseId, StringComparison.OrdinalIgnoreCase)) return false;
            return _houses.TryGetValue(houseId, out house);
        }

        private static int ContextDepth(PlayerInteriorContext context)
        {
            var depth = 0;
            var current = context;
            while (current != null && depth < 64)
            {
                depth++;
                current = current.Previous;
            }
            return depth;
        }

        private static PlayerInteriorContext FindContext(PlayerInteriorContext context, string houseId)
        {
            var current = context;
            var checkedLayers = 0;
            while (current != null && checkedLayers < 64)
            {
                if (string.Equals(current.HouseId, houseId, StringComparison.OrdinalIgnoreCase)) return current;
                current = current.Previous;
                checkedLayers++;
            }
            return null;
        }

        private string ValidateCreateHouse(CreateHouseRequest request)
        {
            if (request == null) return "请求数据无效";
            request.Slug = (request.Slug ?? string.Empty).Trim().ToLowerInvariant();
            request.Label = (request.Label ?? string.Empty).Trim();
            if (!SlugPattern.IsMatch(request.Slug)) return "房屋 ID 只能使用 2-50 位小写字母、数字、_ 或 -";
            if (request.Label.Length < 1 || request.Label.Length > 80) return "显示名称长度必须为 1-80 个字符";
            if (!ValidWorldTransform(request.Entrance)) return "入口坐标无效";

            var preset = FindPreset(request.PresetId);
            if (preset == null) return "室内模板不存在";
            if (string.Equals(preset.Type, "shell", StringComparison.OrdinalIgnoreCase)
                && !ModelPattern.IsMatch((request.ShellModel ?? string.Empty).Trim()))
            {
                return "自定义 Shell 模型名无效";
            }

            return null;
        }

        private InteriorPreset FindPreset(string id)
        {
            if (string.IsNullOrWhiteSpace(id)) return null;
            return _config.Interiors.FirstOrDefault(x => string.Equals(x.Id, id, StringComparison.OrdinalIgnoreCase));
        }

        private static bool IsCurrentLocationPreset(InteriorPreset preset)
        {
            return preset != null && string.Equals(preset.Type, "world", StringComparison.OrdinalIgnoreCase);
        }

        private bool ValidWorldTransform(Transform value)
        {
            return value != null && Finite(value.X) && Finite(value.Y) && Finite(value.Z) && Finite(value.H)
                && Math.Abs(value.X) <= 10000 && Math.Abs(value.Y) <= 10000 && value.Z >= -1000 && value.Z <= 3000;
        }

        private bool ValidInteriorTransform(Transform value, HouseRecord house)
        {
            if (!ValidWorldTransform(value) || house == null || house.Spawn == null) return false;
            var dx = value.X - house.Spawn.X;
            var dy = value.Y - house.Spawn.Y;
            var dz = value.Z - house.Spawn.Z;
            return (dx * dx) + (dy * dy) + (dz * dz) <= 62500.0;
        }

        private bool ValidRotation(Rotation value)
        {
            return value != null && Finite(value.X) && Finite(value.Y) && Finite(value.Z)
                && Math.Abs(value.X) <= 36000 && Math.Abs(value.Y) <= 36000 && Math.Abs(value.Z) <= 36000;
        }

        private static bool Finite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        private ResourceConfig LoadConfig()
        {
            var text = API.LoadResourceFile(API.GetCurrentResourceName(), "config/config.json");
            if (string.IsNullOrWhiteSpace(text)) throw new InvalidOperationException("config/config.json is missing");
            var config = JsonConvert.DeserializeObject<ResourceConfig>(text);
            if (config == null || config.Interiors == null || config.Interiors.Count == 0)
                throw new InvalidOperationException("config/config.json contains no interiors");
            return config;
        }

        private List<HouseRecord> SnapshotHouses()
        {
            return _houses.Values.OrderBy(x => x.Label, StringComparer.OrdinalIgnoreCase).ToList();
        }

        private void BroadcastHouses()
        {
            var json = JsonConvert.SerializeObject(SnapshotHouses());
            foreach (var player in Players) player.TriggerEvent(Prefix + ":client:houses", json);
        }

        private void BroadcastHouseUpdate(HouseRecord house)
        {
            var json = JsonConvert.SerializeObject(house);
            foreach (var player in Players)
            {
                if (_playerContexts.TryGetValue(player.Handle, out var context)
                    && string.Equals(context.HouseId, house.Id, StringComparison.OrdinalIgnoreCase))
                {
                    player.TriggerEvent(Prefix + ":client:houseUpdated", json);
                }
            }
        }

        private void BroadcastToHouse(string houseId, string eventName, object data)
        {
            var json = JsonConvert.SerializeObject(data);
            foreach (var player in Players)
            {
                if (_playerContexts.TryGetValue(player.Handle, out var context)
                    && string.Equals(context.HouseId, houseId, StringComparison.OrdinalIgnoreCase))
                {
                    player.TriggerEvent(eventName, json);
                }
            }
        }

        private void Respond(Player source, string requestId, bool ok, object data, string message, bool latent = false)
        {
            if (source == null) return;
            var payload = JsonConvert.SerializeObject(new
            {
                requestId,
                ok,
                data,
                message
            });
            if (latent) source.TriggerLatentEvent(Prefix + ":client:response", 131072, payload);
            else source.TriggerEvent(Prefix + ":client:response", payload);
        }

        private void OnPlayerDropped(string sourceHandle, string reason)
        {
            if (!string.IsNullOrWhiteSpace(sourceHandle)) _playerContexts.Remove(sourceHandle);
            if (!string.IsNullOrWhiteSpace(sourceHandle)) _fileCooldowns.Remove(sourceHandle);
            if (!string.IsNullOrWhiteSpace(sourceHandle)) _pushCooldowns.Remove(sourceHandle);
        }

        private void OnResourceStop(string resourceName)
        {
            if (!string.Equals(resourceName, API.GetCurrentResourceName(), StringComparison.OrdinalIgnoreCase)) return;
            foreach (var player in Players.ToList())
            {
                if (_playerContexts.TryGetValue(player.Handle, out var context))
                {
                    API.SetPlayerRoutingBucket(player.Handle, context.OriginalBucket);
                }
            }
            _playerContexts.Clear();
        }

        private static string PlayerIdentifier(Player player)
        {
            if (player == null) return "unknown";
            var identifier = API.GetPlayerIdentifier(player.Handle, 0);
            return string.IsNullOrWhiteSpace(identifier) ? "source:" + player.Handle : identifier;
        }

        private static T Parse<T>(string payload, int maxBytes = 65536) where T : class
        {
            try
            {
                if (string.IsNullOrWhiteSpace(payload) || payload.Length > maxBytes
                    || System.Text.Encoding.UTF8.GetByteCount(payload) > maxBytes) return null;
                return JsonConvert.DeserializeObject<T>(payload, new JsonSerializerSettings { MaxDepth = 32, TypeNameHandling = TypeNameHandling.None });
            }
            catch
            {
                return null;
            }
        }

        private static string RequestId(RequestBase request)
        {
            return request == null ? null : request.RequestId;
        }

        private static Transform CopyTransform(Transform source)
        {
            return source == null
                ? new Transform()
                : new Transform { X = source.X, Y = source.Y, Z = source.Z, H = source.H };
        }

        private static Rotation CopyRotation(Rotation source)
        {
            return source == null
                ? new Rotation()
                : new Rotation { X = source.X, Y = source.Y, Z = source.Z };
        }

        private static HouseRecord HouseFromRow(Dictionary<string, object> row)
        {
            var id = ReadString(row, "id");
            if (string.IsNullOrWhiteSpace(id)) return null;
            return new HouseRecord
            {
                Id = id,
                Slug = ReadString(row, "slug"),
                Label = ReadString(row, "label"),
                PresetId = ReadString(row, "preset_id"),
                ShellModel = NullIfEmpty(ReadString(row, "shell_model")),
                Bucket = ReadInt(row, "bucket"),
                Environment = HouseFileCodec.ReadStoredEnvironment(ReadString(row, "environment_json")),
                AccessPoints = ReadAccessPoints(ReadString(row, "access_points_json")),
                Entrance = new Transform
                {
                    X = ReadDouble(row, "entrance_x"), Y = ReadDouble(row, "entrance_y"),
                    Z = ReadDouble(row, "entrance_z"), H = ReadDouble(row, "entrance_h")
                },
                Spawn = new Transform
                {
                    X = ReadDouble(row, "spawn_x"), Y = ReadDouble(row, "spawn_y"),
                    Z = ReadDouble(row, "spawn_z"), H = ReadDouble(row, "spawn_h")
                },
                Exit = new Transform
                {
                    X = ReadDouble(row, "exit_x"), Y = ReadDouble(row, "exit_y"),
                    Z = ReadDouble(row, "exit_z"), H = ReadDouble(row, "exit_h")
                }
            };
        }

        private static DecorationRecord ObjectFromRow(Dictionary<string, object> row)
        {
            var id = ReadString(row, "id");
            if (string.IsNullOrWhiteSpace(id)) return null;
            var sourceKind = ReadString(row, "source_kind");
            var native = string.Equals(sourceKind, "native", StringComparison.OrdinalIgnoreCase);
            return new DecorationRecord
            {
                Id = id,
                HouseId = ReadString(row, "house_id"),
                Model = ReadString(row, "model"),
                Position = new Transform
                {
                    X = ReadDouble(row, "pos_x"), Y = ReadDouble(row, "pos_y"), Z = ReadDouble(row, "pos_z")
                },
                Rotation = new Rotation
                {
                    X = ReadDouble(row, "rot_x"), Y = ReadDouble(row, "rot_y"), Z = ReadDouble(row, "rot_z")
                },
                SourceKind = native ? "native" : "placed",
                SourceModelHash = native ? ReadNullableLong(row, "source_model_hash") : null,
                SourcePosition = native ? new Transform
                {
                    X = ReadDouble(row, "source_pos_x"),
                    Y = ReadDouble(row, "source_pos_y"),
                    Z = ReadDouble(row, "source_pos_z")
                } : null,
                Hidden = native && ReadBool(row, "hidden"),
                DoorOpen = ReadBool(row, "door_open")
            };
        }

        private static string ReadString(Dictionary<string, object> row, string key)
        {
            if (row == null || !row.TryGetValue(key, out var value) || value == null) return string.Empty;
            return Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty;
        }

        private static int ReadInt(Dictionary<string, object> row, string key)
        {
            if (row == null || !row.TryGetValue(key, out var value) || value == null) return 0;
            return Convert.ToInt32(value, CultureInfo.InvariantCulture);
        }

        private static double ReadDouble(Dictionary<string, object> row, string key)
        {
            if (row == null || !row.TryGetValue(key, out var value) || value == null) return 0.0;
            return Convert.ToDouble(value, CultureInfo.InvariantCulture);
        }

        private static long? ReadNullableLong(Dictionary<string, object> row, string key)
        {
            if (row == null || !row.TryGetValue(key, out var value) || value == null) return null;
            return Convert.ToInt64(value, CultureInfo.InvariantCulture);
        }

        private static bool ReadBool(Dictionary<string, object> row, string key)
        {
            if (row == null || !row.TryGetValue(key, out var value) || value == null) return false;
            if (value is bool boolean) return boolean;
            return Convert.ToInt32(value, CultureInfo.InvariantCulture) != 0;
        }

        private static string NullIfEmpty(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? null : value;
        }

        private static string NormalizeLabel(string value)
        {
            var clean = (value ?? string.Empty).Replace("~", string.Empty).Replace("\r", " ").Replace("\n", " ").Trim();
            return Regex.Replace(clean, "\\s+", " ");
        }
    }
}
