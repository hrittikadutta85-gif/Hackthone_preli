"""Builds backend/area/gazetteer.json: Bangladesh divisions, districts, city corporations and well-known
neighbourhoods, with Bangla names, spelling variants and coordinates.

Names, Bangla spellings and the administrative hierarchy are written here. Coordinates are looked up once from
OpenStreetMap's Nominatim service (data © OpenStreetMap contributors, ODbL), at most one request a second as its
usage policy asks, and stored with the file so the app works offline. Re-run to refresh:

    python -m backend.area.build_gazetteer
"""
import json
import sys
import time
from datetime import date
from pathlib import Path

import requests

OUT = Path(__file__).with_name("gazetteer.json")
UA = "DengueWatch-Gazetteer/2.0"  # generic client name; no personal or project details are sent

DIVISIONS = {  # key: (English, Bangla, spelling variants)
    "barishal": ("Barishal", "বরিশাল", ["Barisal"]),
    "chattogram": ("Chattogram", "চট্টগ্রাম", ["Chittagong", "Chottogram"]),
    "dhaka": ("Dhaka", "ঢাকা", ["Dacca"]),
    "khulna": ("Khulna", "খুলনা", []),
    "mymensingh": ("Mymensingh", "ময়মনসিংহ", ["Moymonsingh"]),
    "rajshahi": ("Rajshahi", "রাজশাহী", []),
    "rangpur": ("Rangpur", "রংপুর", []),
    "sylhet": ("Sylhet", "সিলেট", ["Silet"]),
}

DISTRICTS = {  # division: [(English, Bangla, variants)]
    "dhaka": [("Dhaka", "ঢাকা", ["Dacca"]), ("Faridpur", "ফরিদপুর", []), ("Gazipur", "গাজীপুর", []),
              ("Gopalganj", "গোপালগঞ্জ", []), ("Kishoreganj", "কিশোরগঞ্জ", ["Kishorganj"]),
              ("Madaripur", "মাদারীপুর", []), ("Manikganj", "মানিকগঞ্জ", []), ("Munshiganj", "মুন্সীগঞ্জ", ["Munshigonj"]),
              ("Narayanganj", "নারায়ণগঞ্জ", ["Narayangonj"]), ("Narsingdi", "নরসিংদী", ["Narsingdhi"]),
              ("Rajbari", "রাজবাড়ী", []), ("Shariatpur", "শরীয়তপুর", []), ("Tangail", "টাঙ্গাইল", [])],
    "chattogram": [("Bandarban", "বান্দরবান", []), ("Brahmanbaria", "ব্রাহ্মণবাড়িয়া", ["B. Baria", "Brahmonbaria"]),
                   ("Chandpur", "চাঁদপুর", []), ("Chattogram", "চট্টগ্রাম", ["Chittagong", "Chottogram", "Ctg"]),
                   ("Cumilla", "কুমিল্লা", ["Comilla"]), ("Cox's Bazar", "কক্সবাজার", ["Coxs Bazar", "Cox Bazar"]),
                   ("Feni", "ফেনী", []), ("Khagrachhari", "খাগড়াছড়ি", ["Khagrachari"]),
                   ("Lakshmipur", "লক্ষ্মীপুর", ["Laxmipur"]), ("Noakhali", "নোয়াখালী", []),
                   ("Rangamati", "রাঙ্গামাটি", ["Rangamati Hill"])],
    "rajshahi": [("Bogura", "বগুড়া", ["Bogra"]), ("Joypurhat", "জয়পুরহাট", ["Jaipurhat"]), ("Naogaon", "নওগাঁ", []),
                 ("Natore", "নাটোর", []), ("Chapai Nawabganj", "চাঁপাইনবাবগঞ্জ", ["Nawabganj", "Chapainawabganj"]),
                 ("Pabna", "পাবনা", []), ("Rajshahi", "রাজশাহী", []), ("Sirajganj", "সিরাজগঞ্জ", ["Sirajgonj"])],
    "khulna": [("Bagerhat", "বাগেরহাট", []), ("Chuadanga", "চুয়াডাঙ্গা", []), ("Jashore", "যশোর", ["Jessore"]),
               ("Jhenaidah", "ঝিনাইদহ", ["Jhenaidaha"]), ("Khulna", "খুলনা", []), ("Kushtia", "কুষ্টিয়া", []),
               ("Magura", "মাগুরা", []), ("Meherpur", "মেহেরপুর", []), ("Narail", "নড়াইল", []),
               ("Satkhira", "সাতক্ষীরা", [])],
    "barishal": [("Barguna", "বরগুনা", []), ("Barishal", "বরিশাল", ["Barisal"]), ("Bhola", "ভোলা", []),
                 ("Jhalokati", "ঝালকাঠি", ["Jhalakathi", "Jhalokathi"]), ("Patuakhali", "পটুয়াখালী", []),
                 ("Pirojpur", "পিরোজপুর", [])],
    "sylhet": [("Habiganj", "হবিগঞ্জ", []), ("Moulvibazar", "মৌলভীবাজার", ["Maulvibazar"]),
               ("Sunamganj", "সুনামগঞ্জ", []), ("Sylhet", "সিলেট", ["Silet"])],
    "rangpur": [("Dinajpur", "দিনাজপুর", []), ("Gaibandha", "গাইবান্ধা", []), ("Kurigram", "কুড়িগ্রাম", []),
                ("Lalmonirhat", "লালমনিরহাট", []), ("Nilphamari", "নীলফামারী", []), ("Panchagarh", "পঞ্চগড়", []),
                ("Rangpur", "রংপুর", []), ("Thakurgaon", "ঠাকুরগাঁও", [])],
    "mymensingh": [("Jamalpur", "জামালপুর", []), ("Mymensingh", "ময়মনসিংহ", []), ("Netrokona", "নেত্রকোণা", ["Netrakona"]),
                   ("Sherpur", "শেরপুর", [])],
}

# key, English, Bangla, district, variants, dataset city name (None when the forecasting data does not cover it)
CITY_CORPS = [
    ("DNCC", "Dhaka North City Corporation", "ঢাকা উত্তর সিটি কর্পোরেশন", "Dhaka", ["Dhaka North", "DNCC"], "Dhaka North"),
    ("DSCC", "Dhaka South City Corporation", "ঢাকা দক্ষিণ সিটি কর্পোরেশন", "Dhaka", ["Dhaka South", "DSCC"], "Dhaka South"),
    ("CCC", "Chattogram City Corporation", "চট্টগ্রাম সিটি কর্পোরেশন", "Chattogram", ["Chittagong City", "CCC", "Chattogram City"], "Chattogram"),
    ("GCC", "Gazipur City Corporation", "গাজীপুর সিটি কর্পোরেশন", "Gazipur", ["Gazipur City"], "Gazipur"),
    ("NCC", "Narayanganj City Corporation", "নারায়ণগঞ্জ সিটি কর্পোরেশন", "Narayanganj", ["Narayanganj City"], "Narayanganj"),
    ("KCC", "Khulna City Corporation", "খুলনা সিটি কর্পোরেশন", "Khulna", ["Khulna City"], None),
    ("RCC", "Rajshahi City Corporation", "রাজশাহী সিটি কর্পোরেশন", "Rajshahi", ["Rajshahi City"], None),
    ("SCC", "Sylhet City Corporation", "সিলেট সিটি কর্পোরেশন", "Sylhet", ["Sylhet City"], None),
    ("BCC", "Barishal City Corporation", "বরিশাল সিটি কর্পোরেশন", "Barishal", ["Barisal City", "Barishal City"], None),
    ("RpCC", "Rangpur City Corporation", "রংপুর সিটি কর্পোরেশন", "Rangpur", ["Rangpur City"], None),
    ("CuCC", "Cumilla City Corporation", "কুমিল্লা সিটি কর্পোরেশন", "Cumilla", ["Comilla City", "Cumilla City"], None),
    ("MCC", "Mymensingh City Corporation", "ময়মনসিংহ সিটি কর্পোরেশন", "Mymensingh", ["Mymensingh City"], None),
]

# Well-known neighbourhoods inside the five city corporations the forecasting data covers.
# key, English, Bangla, city corporation key, variants
NEIGHBOURHOODS = [
    ("agrabad", "Agrabad", "আগ্রাবাদ", "CCC", []), ("panchlaish", "Panchlaish", "পাঁচলাইশ", "CCC", ["Panchlais"]),
    ("halishahar", "Halishahar", "হালিশহর", "CCC", []), ("nasirabad", "Nasirabad", "নাসিরাবাদ", "CCC", []),
    ("khulshi", "Khulshi", "খুলশী", "CCC", []), ("chawkbazar-ctg", "Chawkbazar", "চকবাজার", "CCC", ["Chakbazar"]),
    ("bahaddarhat", "Bahaddarhat", "বহদ্দারহাট", "CCC", ["Bohoddarhat"]), ("pahartali", "Pahartali", "পাহাড়তলী", "CCC", []),
    ("patenga", "Patenga", "পতেঙ্গা", "CCC", []), ("muradpur", "Muradpur", "মুরাদপুর", "CCC", []),
    ("bakalia", "Bakalia", "বাকলিয়া", "CCC", ["Baklia"]), ("chandgaon", "Chandgaon", "চান্দগাঁও", "CCC", []),
    ("gulshan", "Gulshan", "গুলশান", "DNCC", []), ("banani", "Banani", "বনানী", "DNCC", []),
    ("uttara", "Uttara", "উত্তরা", "DNCC", []), ("mirpur", "Mirpur", "মিরপুর", "DNCC", []),
    ("mohakhali", "Mohakhali", "মহাখালী", "DNCC", []), ("badda", "Badda", "বাড্ডা", "DNCC", []),
    ("tejgaon", "Tejgaon", "তেজগাঁও", "DNCC", []), ("pallabi", "Pallabi", "পল্লবী", "DNCC", []),
    ("mohammadpur", "Mohammadpur", "মোহাম্মদপুর", "DNCC", ["Muhammadpur"]),
    ("dhanmondi", "Dhanmondi", "ধানমন্ডি", "DSCC", ["Dhanmondhi"]), ("motijheel", "Motijheel", "মতিঝিল", "DSCC", ["Motijhil"]),
    ("lalbagh", "Lalbagh", "লালবাগ", "DSCC", []), ("jatrabari", "Jatrabari", "যাত্রাবাড়ী", "DSCC", []),
    ("khilgaon", "Khilgaon", "খিলগাঁও", "DSCC", []), ("shahbagh", "Shahbagh", "শাহবাগ", "DSCC", ["Shahbag"]),
    ("kamrangirchar", "Kamrangirchar", "কামরাঙ্গীরচর", "DSCC", []), ("sadarghat", "Sadarghat", "সদরঘাট", "DSCC", []),
    ("tongi", "Tongi", "টঙ্গী", "GCC", []), ("joydebpur", "Joydebpur", "জয়দেবপুর", "GCC", ["Jaydebpur"]),
    ("siddhirganj", "Siddhirganj", "সিদ্ধিরগঞ্জ", "NCC", ["Siddirganj"]),
]


def slug(s: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in s.lower()).strip("-").replace("--", "-")


def geocode(q: str, last=[0.0]):
    wait = 1.1 - (time.time() - last[0])
    if wait > 0:
        time.sleep(wait)
    last[0] = time.time()
    try:
        r = requests.get("https://nominatim.openstreetmap.org/search", timeout=20, headers={"User-Agent": UA},
                         params={"q": q, "format": "jsonv2", "countrycodes": "bd", "limit": 1})
        res = r.json()
    except Exception as e:  # keep going; a missing point only means "no map position"
        print("  !", q, type(e).__name__, file=sys.stderr)
        return None
    if not res:
        print("  ? not found:", q, file=sys.stderr)
        return None
    return round(float(res[0]["lat"]), 5), round(float(res[0]["lon"]), 5)


def main():
    places = []
    div_of = {}
    for key, (en, bn, alt) in DIVISIONS.items():
        places.append({"id": f"div:{key}", "kind": "division", "name": en, "name_bn": bn, "aliases": alt,
                       "division": en, "division_bn": bn, "point": geocode(f"{en} Division, Bangladesh")})
        print("division", en)
    for div, items in DISTRICTS.items():
        d_en, d_bn, _ = DIVISIONS[div]
        for en, bn, alt in items:
            div_of[en] = (d_en, d_bn, bn)
            places.append({"id": f"dist:{slug(en)}", "kind": "district", "name": en, "name_bn": bn, "aliases": alt,
                           "district": en, "district_bn": bn, "division": d_en, "division_bn": d_bn,
                           "point": geocode(f"{en} District, Bangladesh") or geocode(f"{en}, Bangladesh")})
            print("district", en)
    cc_of = {}
    for key, en, bn, district, alt, city in CITY_CORPS:
        d_en, d_bn, dist_bn = div_of[district]
        cc_of[key] = (en, bn, district, dist_bn, d_en, d_bn)
        q = {"DNCC": "Dhaka North City Corporation", "DSCC": "Dhaka South City Corporation"}.get(key, f"{district} City, Bangladesh")
        places.append({"id": f"cc:{key}", "kind": "city_corporation", "name": en, "name_bn": bn, "aliases": alt,
                       "city_corporation": key, "dataset_city": city, "district": district, "district_bn": dist_bn,
                       "division": d_en, "division_bn": d_bn, "point": geocode(q) or geocode(f"{district}, Bangladesh")})
        print("city corporation", en)
    for key, en, bn, cc, alt in NEIGHBOURHOODS:
        cc_en, cc_bn, district, dist_bn, d_en, d_bn = cc_of[cc]
        city = district if district != "Dhaka" else "Dhaka"
        point = geocode(f"{en}, {city}, Bangladesh")
        if point is None:
            continue  # never guess a position
        places.append({"id": f"nb:{key}", "kind": "neighbourhood", "name": en, "name_bn": bn, "aliases": alt,
                       "city_corporation": cc, "district": district, "district_bn": dist_bn, "division": d_en,
                       "division_bn": d_bn, "point": point})
        print("neighbourhood", en)
    OUT.write_text(json.dumps({
        "source": "Names and hierarchy: Bangladesh administrative divisions (8 divisions, 64 districts, 12 city "
                  "corporations). Coordinates: OpenStreetMap Nominatim, © OpenStreetMap contributors (ODbL).",
        "retrieved": str(date.today()), "note": "Coordinates are approximate centres, for search and map placement only.",
        "places": places}, ensure_ascii=False, indent=1), encoding="utf-8")
    print("wrote", OUT, len(places), "places")


if __name__ == "__main__":
    main()
