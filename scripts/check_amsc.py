from src.database.db_manager import DBManager
db = DBManager()
for c in ["beijing","guangzhou","shanghai","chengdu","chongqing"]:
    r = db.get_latest_raw_observation("amsc_awos", c)
    if r:
        p = r["payload"]
        o = p.get("observation_time", "?")
        pts = p.get("runway_obs", {}).get("point_temperatures", [])
        tmax = [x["target_runway_max"] for x in pts if x.get("target_runway_max")]
        print(c, o[:19], "tmax=", max(tmax) if tmax else "?")
    else:
        print(c, "no data")
