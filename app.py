#!/usr/bin/env python3
import hashlib
import json
import mimetypes
import os
import re
import secrets
import socket
import sqlite3
import subprocess
import time
import unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DATA_DIR = ROOT / "data"
DB_PATH = Path(os.environ.get("ORIENTATION_DB", DATA_DIR / "orientation.sqlite3"))
PROJECT_ID = "shexi-graduation"
COOLDOWN_SECONDS = int(os.environ.get("SUBMIT_COOLDOWN_SECONDS", "15"))
PHASE_MAIN = "main"
PHASE_POST_MAIN_CHOICE = "post_main_choice"
PHASE_BONUS = "bonus"
PHASE_FINAL = "final"
PHASE_COMPLETED = "completed"
VALID_PHASES = {PHASE_MAIN, PHASE_POST_MAIN_CHOICE, PHASE_BONUS, PHASE_FINAL, PHASE_COMPLETED}
MAIN_WAVES = [["A1", "A2"], ["A3", "A6"], ["A4", "A5"]]
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "").strip()
ADMIN_SESSION_TTL_SECONDS = int(os.environ.get("ADMIN_SESSION_TTL_SECONDS", str(12 * 60 * 60)))
ADMIN_LOGIN_WINDOW_SECONDS = int(os.environ.get("ADMIN_LOGIN_WINDOW_SECONDS", "60"))
ADMIN_LOGIN_MAX_FAILURES = int(os.environ.get("ADMIN_LOGIN_MAX_FAILURES", "5"))
MAX_JSON_BODY_BYTES = int(os.environ.get("MAX_JSON_BODY_BYTES", str(64 * 1024)))
COOLDOWN_POLICY = "任一题答错后，终止答题 15s；其他题也需等倒计时结束后再提交。"
ADMIN_LOGIN_FAILURES = {}
BASE_REWARD_LABEL = "纪念奖"
BASE_REWARD_STOCK = 40
LOTTERY_PRIZES = [
    {"tier": "first", "label": "一等奖", "stock": 3},
    {"tier": "second", "label": "二等奖", "stock": 6},
    {"tier": "third", "label": "三等奖", "stock": 18},
]


def question(
    qid,
    title,
    kind,
    required,
    location,
    prompt,
    guidance,
    answer_format,
    aliases,
    hints,
    echo=None,
    image=None,
):
    return {
        "id": qid,
        "title": title,
        "kind": kind,
        "required": required,
        "location": location,
        "prompt": prompt,
        "guidance": guidance,
        "answer_format": answer_format,
        "aliases": aliases,
        "hints": hints,
        "echo": echo,
        "image": image,
    }


QUESTIONS = [
    question(
        "A1",
        "一层导视牌",
        "main",
        True,
        "一层导视牌",
        "回到第一次走进理科五号楼的那天，一层导视牌的字里行间，隐藏了多少“社”字的线索？",
        "站到一层楼层分布牌前，统计面板上出现的“社”字次数。",
        "1 位数字",
        ["5", "五", "5个", "五个"],
        [
            "题面的翻译：站到一层楼层分布牌前，统计面板上出现的“社”字次数。",
            "只数楼层分布牌上印出来的“社”字；网页题面、附近其他牌面都不计入。",
        ],
        {
            "before": "初入燕园，你在千万声音中认出反复写下的",
            "highlight": "社",
            "after": "字。它像一枚小小的印章，盖在一切的开始。",
            "stroke_count": 7,
        },
    ),
    question(
        "A2",
        "一层走廊",
        "main",
        True,
        "一层走廊",
        "先从飞舟老师信箱里借一个门牌号。找到那扇门后，面对房门，门右侧有一块带有红与灰的方形守夜人，请读出它属于第几个巡查点",
        "先找到周飞舟老师的信箱编号，然后找到门牌号为对应数字的房间。站在该房间门口，面对房门，看门右侧红灰色方形固定物上的巡查点编号。",
        "1 位数字",
        ["9", "九", "9号", "九号", "第9号", "第九号", "9号巡查点", "第9号巡查点", "第九号巡查点", "巡查点9", "巡查点 9", "巡查点九", "第9巡查点", "第九巡查点"],
        [
            "题面的翻译：先找到周飞舟老师的信箱编号，然后找到门牌号为对应数字的房间。站在该房间门口，面对房门，看门右侧红灰色方形固定物上的巡查点编号。",
            "信箱编号会带你去对应门牌；站在对应房间门口，面对房门，看门右侧红灰色方形固定物。",
        ],
        {
            "before": "你从信箱走到门牌，又看向房间",
            "highlight": "右",
            "after": "侧那位沉默的守夜人。这一路很长，但每一个细节都值得回望。",
            "stroke_count": 5,
        },
        {
            "src": "/static/assets/a2-zhou-feizhou-mailbox.jpg",
            "alt": "周飞舟老师信箱照片",
        },
    ),
    question(
        "A3",
        "拾级而上",
        "main",
        True,
        "一层到二层的楼梯",
        "从电梯旁的阶梯自一楼向二楼走，脚下有两次提醒你留神。用数字记下它们所在的位置，把两个数字排成最大的可能。",
        "从一楼开始上楼，从第一阶开始数，记录两处“注意台阶”提示语所在台阶级数；得到两个数字后组合成能得到的最大数。",
        "3 位数字",
        ["720", "七百二十", "七二零"],
        [
            "题面的翻译：从一楼开始上楼，从第一阶开始数，记录两处“注意台阶”提示语所在台阶级数；得到两个数字后组合成能得到的最大数。",
            "得到两个数字后不要相加，把它们前后排列，提交能组成的最大数字。",
        ],
        {
            "before": "你一级一级往上走，把脚下的提醒变成继续前",
            "highlight": "行",
            "after": "的坐标。许多路也只是这样，从无到有地一步步走来。",
            "stroke_count": 6,
        },
    ),
    question(
        "A4",
        "二层走廊",
        "main",
        True,
        "二层走廊",
        "二层走廊里，有一扇门挂着“田野刺客”的漫画，找到它和它的主人，回答这位有趣的老师是长发还是短发",
        "在二层走廊寻找门口放有“田野刺客”漫画的老师办公室，判断这位老师是长发还是短发。",
        "2 个汉字",
        ["短发", "短頭髮", "短头发", "短髮", "头发短", "頭髮短"],
        [
            "题面的翻译：在二层走廊寻找门口放有“田野刺客”漫画的老师办公室，判断这位老师是长发还是短发。",
            "找到漫画后辨认它的主人；最后只提交“长发”或“短发”。",
        ],
        {
            "before": "你在",
            "highlight": "二",
            "after": "层走廊停下脚步，对田野与课堂都露出会心一笑。",
            "stroke_count": 2,
        },
        {
            "src": "/static/assets/a4-field-assassin-comic.jpg",
            "alt": "田野刺客漫画照片",
        },
    ),
    question(
        "A5",
        "中庭",
        "main",
        True,
        "中庭",
        "请进入中庭，抬头环望。那些你能看到的、替房间吐纳夏季的机器，一共有多少台？",
        "进入中庭，在中庭内抬头环望、走动观察，统计可看见的空调外机数量。",
        "2 位数字",
        ["32", "三十二", "32台", "三十二台", "32个", "三十二个"],
        [
            "题面的翻译：进入中庭，在中庭内抬头环望、走动观察，统计可看见的空调外机数量。",
            "不要只数高处明显的外机；一层较隐蔽的位置也要纳入，统计在中庭可看见的数量提交。",
        ],
        {
            "before": "你在中庭抬头，眼底掠过许多窗口、外机和光影。第",
            "highlight": "三",
            "after": "次回望时，也许会发现这栋楼也有自己的呼吸。",
            "stroke_count": 3,
        },
    ),
    question(
        "A6",
        "你的名字",
        "main",
        True,
        "二层费孝通像",
        "这个标志性物品在常用教室附近，却还需要你爬升一点高度才能遇见。还记得未入燕园门时，课堂里已先到来的那一缕风吗？去寻找这穿越时空的身影吧，身旁的白色花，已经为你送上了一句祝福：",
        "去二层常用教室附近，寻找与社会学课堂记忆相关的标志性人物像；找到后观察它身旁白色花的常见祝福寓意，提交四字祝福。",
        "4 个汉字",
        ["一帆风顺", "一帆風順", "一帆風顺", "一帆风順", "事业有成", "事業有成", "纯洁平静", "純潔平靜", "平静纯洁", "平靜純潔", "祥和安泰", "品格高尚"],
        [
            "题面的翻译：去二层常用教室附近，寻找与社会学课堂记忆相关的标志性人物像；找到后观察它身旁白色花的常见祝福寓意，提交四字祝福。",
            "答案不是人物姓名。找到人物像后，看它身旁白色花的常见祝福寓意，提交四字祝福。",
        ],
        {
            "before": "你终于找到那尊安静而屹立的身影，也收下那",
            "highlight": "一",
            "after": "份带着清香的祝福。愿离开这里的人，都有顺风、远方和回望时的平和温暖。",
            "stroke_count": 1,
        },
    ),
    question(
        "B1",
        "一间教室",
        "bonus",
        False,
        "203 教室",
        "请在203 教室的电脑桌前找到唯一一只 logitech 蓝边鼠标，记下大写字母 M 和它身后的密码；这个密码会在电脑桌下的《西方社会学理论》中，带你到精心安排的一页。请找出该页中出现频率最高的社会学家：",
        "进入 203，查看电脑桌上的唯一 logitech 蓝边鼠标，找到大写字母 M 后面的编号；再翻电脑桌下的《西方社会学理论》，到编号对应页统计出现频率最高的社会学家。",
        "3 个汉字",
        ["布迪厄", "布迪厄", "布迪厄", "皮埃尔布迪厄", "皮埃尔·布迪厄", "皮埃爾布迪厄", "皮埃爾·布迪厄", "皮埃尔", "皮埃爾", "布尔迪厄", "布爾迪厄", "皮埃尔布尔迪厄", "皮埃尔·布尔迪厄", "皮埃爾布爾迪厄", "皮埃爾·布爾迪厄"],
        [
            "题面的翻译：进入 203，查看电脑桌上的唯一 logitech 蓝边鼠标，找到大写字母 M 后面的编号；再翻电脑桌下的《西方社会学理论》，到编号对应页统计出现频率最高的社会学家。",
            "把编号当作页码翻《西方社会学理论》，统计该页出现最多的社会学家姓名。",
        ],
        {
            "before": "在 203 的桌角与书页之间，你让一只蓝边鼠标接上了理论的回响。书页合上时，社会学的想象力也成了你相伴一生的礼物。",
            "highlight": "",
            "after": "",
            "stroke_count": None,
        },
    ),
    question(
        "B2",
        "理五折叠",
        "bonus",
        False,
        "电梯旁边的一楼到二层楼梯间",
        "睁大眼睛，在电梯旁边的一楼到二楼楼梯间，所有固定贴牌中找出被大写的字母。找出缺失的字母和它们在字母表中的位置，得到几个数字。然后回到这段毕业小景中，提取这几个数字对应的字，把提取出的结果补齐为一句耳熟能详的话：\n\n「一群同学在草地大笑，义工小辉举着闪光相机拍下今日毕业新照。风把学士帽吹得东倒西歪，大家一边追帽子一边嚷着“再来一张”，好像毕业不是散场，而是热热闹闹地换个地方继续出发。」",
        "在电梯旁边的一楼到二楼楼梯间，所有固定贴牌中记录出现过的大写字母，找出缺失字母，并把缺失字母转成字母表序号；再用这些序号到短文中逐字取字。",
        "8 个汉字",
        ["群学大义辉光日新", "群学大义，辉光日新", "群学大义、辉光日新"],
        [
            "题面的翻译：在电梯旁边的一楼到二楼楼梯间，所有固定贴牌中记录出现过的大写字母，找出缺失字母，并把缺失字母转成字母表序号；再用这些序号到短文中逐字取字。",
            "把缺失字母换成字母表序号，用这些序号到网页短文里逐字取字，提交 8 个汉字。",
        ],
        {
            "before": "一边找回楼梯间缺席的字母，一边在青春的影像里提取彩蛋回声。你总是这样，寻寻觅觅，修修补补，发现了很多很多宝藏。",
            "highlight": "",
            "after": "",
            "stroke_count": None,
        },
    ),
    question(
        "B3",
        "立体空间",
        "bonus",
        False,
        "一层与二层门牌",
        "门牌间也有彼此的秘密。请先在一层房间中，找到图中这种门牌上名字为 7 个汉字的房间，记下它对应的房间号 abc。再去寻找门牌号为 b-a a c 的三位数字房间，这个房间门口同侧挂着一幅书法作品，书法内容即为答案。",
        "先在一层找房间名正好 7 个汉字的门牌，记下它的三位房间号 abc；按 b-a、a、c 的规则变换出新门牌号，再到对应房间门口同侧读取书法内容。",
        "8 个简体汉字",
        ["澄怀观道凝神读书", "读书凝神澄怀观道"],
        [
            "题面的翻译：先在一层找房间名正好 7 个汉字的门牌，记下它的三位房间号 abc；按 b-a、a、c 的规则变换出新门牌号，再到对应房间门口同侧读取书法内容。",
            "先找到一层 7 个汉字的房间名，记录房间号 abc；再用 b-a、a、c 变换门牌。",
        ],
        {
            "before": "门与门之间原来也能相互指路，多年以后回想这条长廊、这栋楼房，是否也会后知后觉时光的伏笔呢？",
            "highlight": "",
            "after": "",
            "stroke_count": None,
        },
        {
            "src": "/static/assets/b3-doorplate-sample.jpg",
            "alt": "一层门牌示意图",
        },
    ),
    question(
        "Final",
        "行行重行行",
        "final",
        True,
        "网页终章 + 《行行重行行》简谱",
        "一路的念念不忘，终会得到回响。打开主线百宝箱，六段主线回声里，各有一个被加重的字；数清它们的笔画，让数字由高到低排成一行。再翻开《行行重行行》，到男低音的声部里寻找同样的起伏。仅仅看数字，在熟悉的旋律里，也能找出那句萦绕心底的歌词。",
        "打开主线百宝箱，只看 A1-A6 六段主线回声里的加粗字，并分别数笔画；将得到的数字从大到小排序，再到《行行重行行》男低音唱段里找相同数字旋律。",
        "7 个汉字",
        ["且行且歌共少年"],
        [
            "题面的翻译：打开主线百宝箱，只看 A1-A6 六段主线回声里的加粗字，并分别数笔画；将得到的数字从大到小排序，再到《行行重行行》男低音唱段里找相同数字旋律。",
            "六个笔画数会得到 756231；把它们从大到小排成 765321，再到男低音唱段里找相同数字旋律。",
        ],
    ),
]

QUESTION_BY_ID = {item["id"]: item for item in QUESTIONS}
MAIN_IDS = [item["id"] for item in QUESTIONS if item["kind"] == "main"]
BONUS_IDS = [item["id"] for item in QUESTIONS if item["kind"] == "bonus"]

RESCUE_HINTS = {
    "A1": [
        {"title": "观察范围", "text": "只看一层楼层分布牌。"},
        {"title": "操作翻译", "text": "统计牌面上出现的“社”字，网页题面和附近其他牌面不计入。"},
    ],
    "A2": [
        {"title": "观察范围", "text": "先确认信箱编号对应的门牌，再站到那扇门前。"},
        {"title": "操作翻译", "text": "面对房门，看门右侧红灰色方形固定物，提交巡查点编号。"},
    ],
    "A3": [
        {"title": "观察范围", "text": "只数一楼到二楼这段楼梯。"},
        {"title": "操作翻译", "text": "从第一阶开始数，记录两处提示所在级数，不相加，排列成最大数字。"},
    ],
    "A4": [
        {"title": "观察范围", "text": "寻找门口挂有“田野刺客”漫画的办公室。"},
        {"title": "操作翻译", "text": "确认漫画主人后，只提交发型答案。"},
    ],
    "A5": [
        {"title": "观察范围", "text": "进入中庭后观察四周可见范围。"},
        {"title": "操作翻译", "text": "可以在中庭内走动观察，统计可看见的空调外机数量。"},
    ],
    "A6": [
        {"title": "观察范围", "text": "答案不在人物姓名，而在人物像身旁的白色花。"},
        {"title": "操作翻译", "text": "找到人物像后，看白色花的常见祝福寓意，提交四字祝福。"},
    ],
    "B1": [
        {"title": "观察范围", "text": "只看 203 电脑桌上的唯一 logitech 蓝边鼠标和桌下那本书。"},
        {"title": "操作翻译", "text": "取大写 M 后编号作为页码，翻书统计该页最高频社会学家。"},
    ],
    "B2": [
        {"title": "观察范围", "text": "只统计电梯旁边一楼到二楼楼梯间固定贴牌中的大写字母。"},
        {"title": "操作翻译", "text": "找出缺失字母，转成字母表序号，再用这些序号到网页短文中逐字取字。"},
    ],
    "B3": [
        {"title": "观察范围", "text": "先找一层房间名正好 7 个汉字的门牌。"},
        {"title": "操作翻译", "text": "记录房号 abc，按 b-a、a、c 变换为新房号，再到对应门口读取书法。"},
    ],
    "Final": [
        {"title": "观察范围", "text": "只看 A1-A6 主线百宝箱，不看旁枝百宝箱。"},
        {"title": "操作翻译", "text": "数清六个主线加重字的笔画，排序后到男低音唱段找相同数字旋律。"},
    ],
}

BONUS_META = {
    "B1": {"difficulty": "中"},
    "B2": {"difficulty": "较高"},
    "B3": {"difficulty": "较高"},
}

SCORE_IMAGES = [
    {
        "src": f"/static/assets/shexi-score-page-{index}.png",
        "alt": f"《行行重行行》简谱第 {index} 页",
        "caption": f"《行行重行行》简谱第 {index} 页",
    }
    for index in range(1, 6)
]


PROJECT = {
    "id": PROJECT_ID,
    "name": "社系毕业晚会解密",
    "tagline": "在理科五号楼一二层与中庭里，收集六段毕业回声，最后唱出终章口令。",
    "location": "理科五号楼一二层、中庭",
    "status": "可试玩",
    "cooldown_seconds": COOLDOWN_SECONDS,
}


def now_ts():
    return time.time()


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        result = super().__exit__(exc_type, exc_value, traceback)
        self.close()
        return result


def connect(db_path=DB_PATH):
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db_path, timeout=10, factory=ClosingConnection)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode = WAL")
    con.execute("PRAGMA busy_timeout = 8000")
    return con


def init_db(db_path=DB_PATH):
    with connect(db_path) as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS participants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                public_id TEXT NOT NULL UNIQUE,
                student_id TEXT,
                phone TEXT,
                nickname TEXT,
                participant_kind TEXT NOT NULL DEFAULT 'individual',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                participant_id TEXT NOT NULL,
                project_id TEXT NOT NULL,
                question_id TEXT NOT NULL,
                answer TEXT NOT NULL,
                normalized_answer TEXT NOT NULL,
                is_correct INTEGER NOT NULL DEFAULT 0,
                is_rate_limited INTEGER NOT NULL DEFAULT 0,
                message TEXT NOT NULL,
                submitted_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS progress (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                participant_id TEXT NOT NULL,
                project_id TEXT NOT NULL,
                question_id TEXT NOT NULL,
                echo_json TEXT,
                completed_at REAL NOT NULL,
                UNIQUE(participant_id, project_id, question_id)
            );

            CREATE TABLE IF NOT EXISTS redeem_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                participant_id TEXT NOT NULL,
                project_id TEXT NOT NULL,
                code TEXT NOT NULL UNIQUE,
                created_at REAL NOT NULL,
                redeemed_at REAL,
                redeemed_by TEXT,
                cyber_gift_at REAL,
                cyber_gift_by TEXT,
                note TEXT,
                UNIQUE(participant_id, project_id)
            );

            CREATE TABLE IF NOT EXISTS lottery_draws (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                participant_id TEXT NOT NULL,
                project_id TEXT NOT NULL,
                draw_index INTEGER NOT NULL,
                prize_tier TEXT NOT NULL,
                prize_label TEXT NOT NULL,
                created_at REAL NOT NULL,
                UNIQUE(participant_id, project_id, draw_index)
            );

            CREATE TABLE IF NOT EXISTS project_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                participant_id TEXT NOT NULL,
                project_id TEXT NOT NULL,
                phase TEXT NOT NULL DEFAULT 'main',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                UNIQUE(participant_id, project_id)
            );

            CREATE TABLE IF NOT EXISTS admin_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL UNIQUE,
                nickname TEXT NOT NULL,
                staff_name TEXT NOT NULL,
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS participant_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                participant_id TEXT NOT NULL,
                project_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                payload_json TEXT,
                created_at REAL NOT NULL,
                consumed_at REAL
            );
            """
        )
        migrate_db(con)


def migrate_db(con):
    participant_columns = {row["name"] for row in con.execute("PRAGMA table_info(participants)").fetchall()}
    if "student_id" not in participant_columns:
        con.execute("ALTER TABLE participants ADD COLUMN student_id TEXT")
    if "phone" not in participant_columns:
        con.execute("ALTER TABLE participants ADD COLUMN phone TEXT")
    redeem_columns = {row["name"] for row in con.execute("PRAGMA table_info(redeem_codes)").fetchall()}
    if "cyber_gift_at" not in redeem_columns:
        con.execute("ALTER TABLE redeem_codes ADD COLUMN cyber_gift_at REAL")
    if "cyber_gift_by" not in redeem_columns:
        con.execute("ALTER TABLE redeem_codes ADD COLUMN cyber_gift_by TEXT")
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS participant_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            participant_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload_json TEXT,
            created_at REAL NOT NULL,
            consumed_at REAL
        )
        """
    )
    con.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_student_id
        ON participants(student_id)
        WHERE student_id IS NOT NULL AND student_id != ''
        """
    )


def normalize_answer(value):
    normalized = unicodedata.normalize("NFKC", value or "").strip().lower()
    normalized = re.sub(r"\s+", "", normalized)
    normalized = re.sub(r"[，,。.!！?？:：;；、·\-—_（）()\[\]【】「」『』《》<>“”\"'`]", "", normalized)
    return normalized


def answer_variants(value):
    normalized = normalize_answer(value)
    variants = {normalized}
    stripped_units = re.sub(r"(个|位|号|台|级|阶|次|处|站|巡查点)$", "", normalized)
    if stripped_units:
        variants.add(stripped_units)
    return variants


def answer_matches(item, answer):
    normalized_variants = answer_variants(answer)
    accepted = set()
    for alias in item["aliases"]:
        accepted.update(answer_variants(alias))
    return bool(normalized_variants & accepted)


def normalize_student_id(value):
    normalized = unicodedata.normalize("NFKC", value or "")
    normalized = re.sub(r"\s+", "", normalized)
    return normalized.upper()


def normalize_phone(value):
    normalized = unicodedata.normalize("NFKC", value or "")
    normalized = re.sub(r"\D+", "", normalized)
    return normalized


def validate_student_id(student_id):
    if not re.fullmatch(r"\d{10}", student_id or ""):
        raise ValueError("请输入 10 位数字学号。")


def validate_phone(phone):
    if not re.fullmatch(r"\d{11}", phone or ""):
        raise ValueError("请输入 11 位手机号。")


def public_question(item, completed=False, locked=False, progress_row=None, wrong_count=0):
    data = {
        "id": item["id"],
        "title": item["title"],
        "kind": item["kind"],
        "required": item["required"],
        "location": item["location"],
        "prompt": item["prompt"],
        "answer_format": item["answer_format"],
        "rescue_hints_unlocked": rescue_hints_for_wrong_count(item, wrong_count),
        "completed": completed,
        "locked": locked,
    }
    if item["id"] in BONUS_META:
        data["bonus_meta"] = BONUS_META[item["id"]]
    if item.get("image"):
        data["image"] = item["image"]
    if completed and progress_row:
        data["completed_at"] = progress_row["completed_at"]
        data["echo"] = public_echo(json.loads(progress_row["echo_json"])) if progress_row["echo_json"] else None
    if locked:
        data["locked_reason"] = "完成 A1-A6 全部主线题后解锁。"
    return data


def public_echo(echo):
    if not echo:
        return None
    return {
        "before": echo.get("before", ""),
        "highlight": echo.get("highlight", ""),
        "after": echo.get("after", ""),
    }


def rescue_hints_for_wrong_count(item, wrong_count):
    hints = RESCUE_HINTS.get(item["id"], [])
    if wrong_count < 2:
        return []
    if wrong_count == 2:
        return hints[:1]
    return hints[:2]


def wrong_count_for_question(con, participant_id, question_id):
    return consecutive_wrong_count_for_question(con, participant_id, question_id)


def consecutive_wrong_count_for_question(con, participant_id, question_id):
    rows = con.execute(
        """
        SELECT is_correct, is_rate_limited FROM submissions
        WHERE participant_id = ? AND project_id = ? AND question_id = ?
        ORDER BY submitted_at DESC, id DESC
        """,
        (participant_id, PROJECT_ID, question_id),
    ).fetchall()
    count = 0
    for row in rows:
        if row["is_rate_limited"]:
            continue
        if row["is_correct"]:
            break
        count += 1
    return count


def create_public_id(con):
    for _ in range(20):
        public_id = f"P-{secrets.token_hex(3).upper()}"
        existing = con.execute("SELECT 1 FROM participants WHERE public_id = ?", (public_id,)).fetchone()
        if not existing:
            return public_id
    raise RuntimeError("Could not create a unique participant id")


def get_participant(public_id, db_path=DB_PATH):
    with connect(db_path) as con:
        row = con.execute("SELECT * FROM participants WHERE public_id = ?", (public_id,)).fetchone()
        return dict(row) if row else None


def create_or_restore_participant(payload, db_path=DB_PATH):
    public_id = (payload.get("participant_id") or payload.get("participantId") or "").strip()
    student_id = normalize_student_id(payload.get("student_id") or payload.get("studentId") or "")
    phone = normalize_phone(payload.get("phone") or "")
    nickname = (payload.get("nickname") or "").strip()
    participant_kind = (payload.get("participant_kind") or payload.get("participantKind") or "individual").strip()
    force_new = bool(payload.get("force_new") or payload.get("forceNew"))
    if participant_kind not in {"individual", "team", "tester"}:
        participant_kind = "individual"
    if participant_kind == "tester":
        student_id = ""
        phone = ""

    current_time = now_ts()
    with connect(db_path) as con:
        if public_id and not force_new:
            row = con.execute("SELECT * FROM participants WHERE public_id = ?", (public_id,)).fetchone()
            if row:
                if nickname and nickname != (row["nickname"] or ""):
                    con.execute(
                        "UPDATE participants SET nickname = ?, updated_at = ? WHERE public_id = ?",
                        (nickname, current_time, public_id),
                    )
                    row = con.execute("SELECT * FROM participants WHERE public_id = ?", (public_id,)).fetchone()
                return {"participant": serialize_participant(row), "created": False}

        if participant_kind != "tester":
            validate_student_id(student_id)
            validate_phone(phone)

        if student_id and not force_new:
            row = con.execute("SELECT * FROM participants WHERE student_id = ?", (student_id,)).fetchone()
            if row:
                existing_phone = row["phone"] or ""
                if existing_phone and existing_phone != phone:
                    raise ValueError("学号或手机号与已有记录不一致。")
                if not existing_phone and phone:
                    con.execute(
                        "UPDATE participants SET phone = ?, updated_at = ? WHERE student_id = ?",
                        (phone, current_time, student_id),
                    )
                    row = con.execute("SELECT * FROM participants WHERE student_id = ?", (student_id,)).fetchone()
                if nickname and nickname != (row["nickname"] or ""):
                    con.execute(
                        "UPDATE participants SET nickname = ?, updated_at = ? WHERE student_id = ?",
                        (nickname, current_time, student_id),
                    )
                    row = con.execute("SELECT * FROM participants WHERE student_id = ?", (student_id,)).fetchone()
                return {"participant": serialize_participant(row), "created": False}
        if student_id and force_new:
            row = con.execute("SELECT * FROM participants WHERE student_id = ?", (student_id,)).fetchone()
            if row:
                raise ValueError("这个学号已经参与过；请刷新或重新打开页面回到当前进度。")

        if participant_kind != "tester" and not student_id:
            raise ValueError("请输入学号后再进入活动。")

        public_id = create_public_id(con)
        con.execute(
            """
            INSERT INTO participants (public_id, student_id, phone, nickname, participant_kind, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (public_id, student_id or None, phone or None, nickname or None, participant_kind, current_time, current_time),
        )
        row = con.execute("SELECT * FROM participants WHERE public_id = ?", (public_id,)).fetchone()
        return {"participant": serialize_participant(row), "created": True}


def serialize_participant(row):
    return {
        "id": row["public_id"],
        "student_id": row["student_id"] or "",
        "phone": row["phone"] or "",
        "nickname": row["nickname"] or "",
        "participant_kind": row["participant_kind"],
        "created_at": row["created_at"],
    }


def get_or_create_project_session(con, participant_id, current_time=None):
    current_time = current_time if current_time is not None else now_ts()
    row = con.execute(
        """
        SELECT * FROM project_sessions
        WHERE participant_id = ? AND project_id = ?
        """,
        (participant_id, PROJECT_ID),
    ).fetchone()
    if row:
        return row
    con.execute(
        """
        INSERT INTO project_sessions (participant_id, project_id, phase, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (participant_id, PROJECT_ID, PHASE_MAIN, current_time, current_time),
    )
    return con.execute(
        """
        SELECT * FROM project_sessions
        WHERE participant_id = ? AND project_id = ?
        """,
        (participant_id, PROJECT_ID),
    ).fetchone()


def set_project_phase(con, participant_id, phase, current_time=None):
    if phase not in VALID_PHASES:
        raise ValueError("未知的游戏阶段。")
    current_time = current_time if current_time is not None else now_ts()
    get_or_create_project_session(con, participant_id, current_time)
    con.execute(
        """
        UPDATE project_sessions
        SET phase = ?, updated_at = ?
        WHERE participant_id = ? AND project_id = ?
        """,
        (phase, current_time, participant_id, PROJECT_ID),
    )
    return get_or_create_project_session(con, participant_id, current_time)


def get_project_session(con, participant_id):
    return con.execute(
        """
        SELECT * FROM project_sessions
        WHERE participant_id = ? AND project_id = ?
        """,
        (participant_id, PROJECT_ID),
    ).fetchone()


def display_phase_from_progress(session_phase, progress):
    phase = session_phase or PHASE_MAIN
    if "Final" in progress:
        return PHASE_COMPLETED
    if all_main_complete(progress) and phase == PHASE_MAIN:
        return PHASE_POST_MAIN_CHOICE
    if not all_main_complete(progress) and phase != PHASE_MAIN:
        return PHASE_MAIN
    return phase


def progress_map(con, participant_id):
    rows = con.execute(
        """
        SELECT * FROM progress
        WHERE participant_id = ? AND project_id = ?
        ORDER BY completed_at ASC
        """,
        (participant_id, PROJECT_ID),
    ).fetchall()
    return {row["question_id"]: row for row in rows}


def progress_rows_in_order(con, participant_id):
    return con.execute(
        """
        SELECT * FROM progress
        WHERE participant_id = ? AND project_id = ?
        ORDER BY completed_at ASC
        """,
        (participant_id, PROJECT_ID),
    ).fetchall()


def all_main_complete(progress):
    return all(qid in progress for qid in MAIN_IDS)


def completed_bonus_count(progress):
    return sum(1 for qid in BONUS_IDS if qid in progress)


def current_main_wave_ids(progress):
    for wave in MAIN_WAVES:
        if not all(qid in progress for qid in wave):
            return wave
    return []


def ordered_wave_ids_for_participant(wave, participant_id):
    ids = list(wave)
    if len(ids) <= 1:
        return ids
    seed = f"{PROJECT_ID}:{participant_id}:{','.join(ids)}".encode("utf-8")
    digest = hashlib.sha256(seed).digest()
    if digest[0] % 2:
        ids.reverse()
    return ids


def reconcile_project_session(con, participant_id, progress, current_time=None):
    current_time = current_time if current_time is not None else now_ts()
    session = get_or_create_project_session(con, participant_id, current_time)
    phase = session["phase"]

    if "Final" in progress:
        return set_project_phase(con, participant_id, PHASE_COMPLETED, current_time)

    if all_main_complete(progress):
        if phase == PHASE_MAIN:
            return set_project_phase(con, participant_id, PHASE_POST_MAIN_CHOICE, current_time)
    elif phase != PHASE_MAIN:
        return set_project_phase(con, participant_id, PHASE_MAIN, current_time)

    return get_or_create_project_session(con, participant_id, current_time)


def visible_question_ids(phase, progress, participant_id):
    if phase == PHASE_MAIN:
        ids = []
        for qid in MAIN_IDS:
            if qid in progress:
                ids.append(qid)
        ids.extend(ordered_wave_ids_for_participant(current_main_wave_ids(progress), participant_id))
        return list(dict.fromkeys(ids))
    if phase == PHASE_BONUS:
        return BONUS_IDS[:]
    if phase == PHASE_FINAL:
        return ["Final"]
    return []


def submittable_question_ids(phase, progress):
    if phase == PHASE_MAIN:
        return current_main_wave_ids(progress)
    if phase == PHASE_BONUS:
        return BONUS_IDS[:]
    if phase == PHASE_FINAL:
        return ["Final"]
    return []


def get_redeem_code(con, participant_id):
    return con.execute(
        """
        SELECT * FROM redeem_codes
        WHERE participant_id = ? AND project_id = ?
        """,
        (participant_id, PROJECT_ID),
    ).fetchone()


def lottery_draw_rows(con, participant_id):
    return con.execute(
        """
        SELECT * FROM lottery_draws
        WHERE participant_id = ? AND project_id = ?
        ORDER BY draw_index ASC
        """,
        (participant_id, PROJECT_ID),
    ).fetchall()


def serialize_lottery_draw(row):
    return {
        "draw_index": row["draw_index"],
        "prize_tier": row["prize_tier"],
        "prize_label": row["prize_label"],
        "created_at": row["created_at"],
    }


def lottery_prize_counts(draws):
    counts = {}
    for row in draws:
        counts[row["prize_label"]] = counts.get(row["prize_label"], 0) + 1
    return counts


def format_prize_summary(draws):
    counts = lottery_prize_counts(draws)
    parts = []
    for prize in LOTTERY_PRIZES:
        count = counts.get(prize["label"], 0)
        if count:
            parts.append(f"{prize['label']} {count} 份")
    other_count = counts.get("额外奖候补", 0)
    if other_count:
        parts.append(f"额外奖候补 {other_count} 份")
    return " + ".join(parts)


def lottery_inventory(con):
    used_rows = con.execute(
        """
        SELECT prize_tier, COUNT(*) AS count
        FROM lottery_draws
        WHERE project_id = ?
        GROUP BY prize_tier
        """,
        (PROJECT_ID,),
    ).fetchall()
    used = {row["prize_tier"]: row["count"] for row in used_rows}
    prizes = []
    for prize in LOTTERY_PRIZES:
        used_count = used.get(prize["tier"], 0)
        remaining = max(0, prize["stock"] - used_count)
        prizes.append(
            {
                "tier": prize["tier"],
                "label": prize["label"],
                "stock": prize["stock"],
                "drawn": used_count,
                "remaining": remaining,
            }
        )
    return {
        "prizes": prizes,
        "drawn": sum(item["drawn"] for item in prizes),
        "remaining": sum(item["remaining"] for item in prizes),
        "stock": sum(item["stock"] for item in prizes),
    }


def public_lottery_state(con, participant_id, progress=None):
    progress = progress if progress is not None else progress_map(con, participant_id)
    final_complete = "Final" in progress
    chances_total = completed_bonus_count(progress) if final_complete else 0
    draws = lottery_draw_rows(con, participant_id)
    draws_used = len(draws)
    draws_remaining = max(0, chances_total - draws_used)
    prize_summary = format_prize_summary(draws)
    if final_complete:
        award_summary = BASE_REWARD_LABEL
        if prize_summary:
            award_summary = f"{award_summary} + {prize_summary}"
        elif draws_remaining:
            award_summary = f"{award_summary} + 待抽奖 {draws_remaining} 次"
    else:
        award_summary = ""
    return {
        "base_reward": BASE_REWARD_LABEL if final_complete else "",
        "chances_total": chances_total,
        "draws_used": draws_used,
        "draws_remaining": draws_remaining,
        "draws": [serialize_lottery_draw(row) for row in draws],
        "prize_summary": prize_summary,
        "award_summary": award_summary,
    }


def get_project_state(participant_id, db_path=DB_PATH):
    with connect(db_path) as con:
        participant = con.execute("SELECT * FROM participants WHERE public_id = ?", (participant_id,)).fetchone()
        if not participant:
            raise ValueError("参与者不存在，请刷新页面重新进入活动。")
        progress = progress_map(con, participant_id)
        progress_rows = progress_rows_in_order(con, participant_id)
        session = get_project_session(con, participant_id)
        phase = display_phase_from_progress(session["phase"] if session else None, progress)
        main_complete = all_main_complete(progress)
        redeem = get_redeem_code(con, participant_id)
        last_wrong_submission = con.execute(
            """
            SELECT submitted_at FROM submissions
            WHERE participant_id = ? AND project_id = ? AND is_rate_limited = 0
              AND is_correct = 0
            ORDER BY submitted_at DESC LIMIT 1
            """,
            (participant_id, PROJECT_ID),
        ).fetchone()
        current_time = now_ts()
        cooldown_remaining = 0
        if last_wrong_submission:
            remaining = COOLDOWN_SECONDS - (current_time - last_wrong_submission["submitted_at"])
            cooldown_remaining = max(0, int(remaining + 0.999))

        visible_ids = visible_question_ids(phase, progress, participant_id)
        questions = []
        for qid in visible_ids:
            item = QUESTION_BY_ID[qid]
            completed = qid in progress
            questions.append(
                public_question(
                    item,
                    completed=completed,
                    locked=False,
                    progress_row=progress.get(qid),
                    wrong_count=wrong_count_for_question(con, participant_id, qid),
                )
            )

        completed_echo_questions = []
        for row in progress_rows:
            qid = row["question_id"]
            if qid == "Final" or qid not in QUESTION_BY_ID:
                continue
            completed_echo_questions.append(
                public_question(
                    QUESTION_BY_ID[qid],
                    completed=True,
                    progress_row=row,
                    wrong_count=wrong_count_for_question(con, participant_id, qid),
                )
            )
        completed_main_questions = [item for item in completed_echo_questions if item["kind"] == "main"]
        completed_bonus_questions = [item for item in completed_echo_questions if item["kind"] == "bonus"]
        bonus_completed = completed_bonus_count(progress)
        lottery = public_lottery_state(con, participant_id, progress)
        award = participant_award_details(con, participant_id, progress=progress, lottery=lottery)

        return {
            "project": PROJECT,
            "participant": serialize_participant(participant),
            "phase": phase,
            "questions": questions,
            "completed_echo_questions": completed_echo_questions,
            "completed_main_questions": completed_main_questions,
            "completed_bonus_questions": completed_bonus_questions,
            "visible_question_ids": visible_ids,
            "main_ids": MAIN_IDS,
            "bonus_ids": BONUS_IDS,
            "main_complete": main_complete,
            "final_complete": "Final" in progress,
            "bonus_completed": bonus_completed,
            "extra_lottery_chances": bonus_completed,
            "base_reward_unlocked": main_complete,
            "cooldown_remaining": cooldown_remaining,
            "cooldown_policy": COOLDOWN_POLICY,
            "lottery": lottery,
            "redeem_code": serialize_redeem(redeem, award=award, lottery=lottery)
            if ("Final" in progress and redeem and lottery["draws_remaining"] == 0)
            else None,
            "score_images": SCORE_IMAGES,
        }


def serialize_redeem(row, award=None, lottery=None):
    return {
        "code": row["code"],
        "created_at": row["created_at"],
        "redeemed_at": row["redeemed_at"],
        "redeemed": bool(row["redeemed_at"]),
        "redeemed_by": row["redeemed_by"] or "",
        "cyber_gift_at": row["cyber_gift_at"],
        "cyber_gift_by": row["cyber_gift_by"] or "",
        "cyber_gift_sent": bool(row["cyber_gift_at"]),
        "note": row["note"] or "",
        "award_summary": award["award_level"] if award else "",
        "lottery": lottery or {},
    }


def serialize_participant_event(row):
    payload = json.loads(row["payload_json"]) if row["payload_json"] else {}
    return {
        "id": row["id"],
        "type": row["event_type"],
        "payload": payload,
        "created_at": row["created_at"],
    }


def create_participant_event(con, participant_id, event_type, payload=None, current_time=None):
    current_time = current_time if current_time is not None else now_ts()
    con.execute(
        """
        INSERT INTO participant_events (participant_id, project_id, event_type, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (participant_id, PROJECT_ID, event_type, json.dumps(payload or {}, ensure_ascii=False), current_time),
    )


def pending_participant_events(participant_id, db_path=DB_PATH):
    with connect(db_path) as con:
        participant = con.execute("SELECT 1 FROM participants WHERE public_id = ?", (participant_id,)).fetchone()
        if not participant:
            raise ValueError("参与者不存在，请刷新页面重新进入活动。")
        rows = con.execute(
            """
            SELECT * FROM participant_events
            WHERE participant_id = ? AND project_id = ? AND consumed_at IS NULL
            ORDER BY created_at ASC, id ASC
            LIMIT 5
            """,
            (participant_id, PROJECT_ID),
        ).fetchall()
        return {"events": [serialize_participant_event(row) for row in rows]}


def consume_participant_event(participant_id, event_id, db_path=DB_PATH):
    event_id = int(event_id or 0)
    with connect(db_path) as con:
        row = con.execute(
            """
            SELECT * FROM participant_events
            WHERE id = ? AND participant_id = ? AND project_id = ?
            """,
            (event_id, participant_id, PROJECT_ID),
        ).fetchone()
        if not row:
            raise ValueError("事件不存在。")
        if not row["consumed_at"]:
            con.execute(
                "UPDATE participant_events SET consumed_at = ? WHERE id = ?",
                (now_ts(), event_id),
            )
        return {"ok": True}


def wrong_answer_message(item, wrong_count_after):
    if wrong_count_after >= 3:
        return "还没有对上，第二张救援提示也已展开。"
    if wrong_count_after == 2:
        return "还没有对上，救援提示已展开。"
    if item["kind"] == "final":
        return "还没有对上，请再回看六条毕业回声和简谱里的男低音唱段。"
    return "还没有对上，请再核对题面和现场固定信息。"


def completion_echo(item):
    if item["kind"] == "main":
        return item["echo"]
    if item["kind"] == "bonus":
        return item["echo"] or {
            "before": "你在主线之外多拾起一枚微光。它不会改变终章的方向，却会让这一程更丰盛。",
            "highlight": "",
            "after": "",
            "stroke_count": None,
        }
    return {
        "before": "念百年，筚路蓝缕志弥坚；愿今生，且行且歌共少年🎵\n一路且行且歌，不觉已行至一程终点。恭喜你顺利通关！\n与社会学系结缘这些年，你的身后是百年学养，身边是同群相伴，而眼前，也必定是光辉灿烂、且行且歌的广阔世界。\n请带着完成凭证前往兑奖处领取礼物，也把这一晚的回声带向下一段旅程。\n游戏已至终章，新篇方才起步。谢谢你走到这里，愿此去一路有光。",
        "highlight": "",
        "after": "",
        "stroke_count": None,
    }


def create_redeem_code(con, participant_id):
    existing = get_redeem_code(con, participant_id)
    if existing:
        return existing
    current_time = now_ts()
    for _ in range(20):
        code = f"SX-{secrets.token_hex(2).upper()}-{secrets.token_hex(2).upper()}"
        exists = con.execute("SELECT 1 FROM redeem_codes WHERE code = ?", (code,)).fetchone()
        if not exists:
            con.execute(
                """
                INSERT INTO redeem_codes (participant_id, project_id, code, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (participant_id, PROJECT_ID, code, current_time),
            )
            return get_redeem_code(con, participant_id)
    raise RuntimeError("Could not create a unique redeem code")


def submit_answer(participant_id, question_id, answer, db_path=DB_PATH, current_time=None):
    current_time = current_time if current_time is not None else now_ts()
    question_id = (question_id or "").strip()
    answer = answer or ""
    item = QUESTION_BY_ID.get(question_id)
    if not item:
        raise ValueError("题目不存在。")

    with connect(db_path) as con:
        con.execute("BEGIN IMMEDIATE")
        participant = con.execute("SELECT * FROM participants WHERE public_id = ?", (participant_id,)).fetchone()
        if not participant:
            raise ValueError("参与者不存在，请刷新页面重新进入活动。")

        progress = progress_map(con, participant_id)
        session = reconcile_project_session(con, participant_id, progress, current_time)
        phase = session["phase"]
        allowed_ids = submittable_question_ids(phase, progress)
        if question_id not in allowed_ids:
            if phase == PHASE_POST_MAIN_CHOICE:
                raise ValueError("请先选择现在开启终章，或先探索旁枝。")
            if phase == PHASE_COMPLETED:
                raise ValueError("游戏已经完成，无法继续提交新的题目。")
            if item["kind"] == "bonus" and phase in {PHASE_FINAL, PHASE_COMPLETED}:
                raise ValueError("终章已开启，未完成的旁枝题已经关闭。")
            raise ValueError("这道题还没有开放，请先完成当前阶段。")
        if question_id in progress:
            raise ValueError("这道题已经完成，不需要重复提交。")

        last_wrong_submission = con.execute(
            """
            SELECT submitted_at FROM submissions
            WHERE participant_id = ? AND project_id = ? AND is_rate_limited = 0
              AND is_correct = 0
            ORDER BY submitted_at DESC LIMIT 1
            """,
            (participant_id, PROJECT_ID),
        ).fetchone()
        if last_wrong_submission:
            remaining = COOLDOWN_SECONDS - (current_time - last_wrong_submission["submitted_at"])
            if remaining > 0:
                message = f"任一题答错后，终止答题 15s，还剩 {int(remaining + 0.999)} 秒。"
                con.execute(
                    """
                    INSERT INTO submissions
                    (participant_id, project_id, question_id, answer, normalized_answer, is_correct, is_rate_limited, message, submitted_at)
                    VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)
                    """,
                    (participant_id, PROJECT_ID, question_id, answer, normalize_answer(answer), message, current_time),
                )
                con.commit()
                return {
                    "ok": False,
                    "rate_limited": True,
                    "cooldown_remaining": int(remaining + 0.999),
                    "message": message,
                    "state": get_project_state(participant_id, db_path),
                }

        normalized = normalize_answer(answer)
        is_correct = answer_matches(item, answer)
        echo = None
        if is_correct:
            echo = completion_echo(item)
            con.execute(
                """
                INSERT INTO progress (participant_id, project_id, question_id, echo_json, completed_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(participant_id, project_id, question_id)
                DO UPDATE SET echo_json = excluded.echo_json
                """,
                (participant_id, PROJECT_ID, question_id, json.dumps(echo, ensure_ascii=False), current_time),
            )
            if item["kind"] == "final":
                set_project_phase(con, participant_id, PHASE_COMPLETED, current_time)
                create_redeem_code(con, participant_id)
                message = "念百年，筚路蓝缕志弥坚；愿今生，且行且歌共少年🎵 一路且行且歌，不觉已行至一程终点。恭喜你顺利通关！"
            elif item["kind"] == "main" and all_main_complete({**progress, question_id: True}):
                set_project_phase(con, participant_id, PHASE_POST_MAIN_CHOICE, current_time)
                message = "回答正确，收到一条回声。"
            else:
                message = "回答正确，收到一条回声。"
        else:
            wrong_count_after = wrong_count_for_question(con, participant_id, question_id) + 1
            message = wrong_answer_message(item, wrong_count_after)

        con.execute(
            """
            INSERT INTO submissions
            (participant_id, project_id, question_id, answer, normalized_answer, is_correct, is_rate_limited, message, submitted_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (participant_id, PROJECT_ID, question_id, answer, normalized, int(is_correct), message, current_time),
        )

    return {
        "ok": is_correct,
        "rate_limited": False,
        "message": message,
        "echo": public_echo(echo) if echo else None,
        "state": get_project_state(participant_id, db_path),
    }


def make_project_decision(participant_id, action, db_path=DB_PATH, current_time=None):
    current_time = current_time if current_time is not None else now_ts()
    action = (action or "").strip()
    with connect(db_path) as con:
        participant = con.execute("SELECT * FROM participants WHERE public_id = ?", (participant_id,)).fetchone()
        if not participant:
            raise ValueError("参与者不存在，请刷新页面重新进入活动。")

        progress = progress_map(con, participant_id)
        session = reconcile_project_session(con, participant_id, progress, current_time)
        phase = session["phase"]
        if phase not in {PHASE_POST_MAIN_CHOICE, PHASE_BONUS}:
            raise ValueError("当前阶段不能切换终章或旁枝。")
        if not all_main_complete(progress):
            raise ValueError("需要完成 A1-A6 全部主线题后才能选择。")

        if action == "start_final":
            set_project_phase(con, participant_id, PHASE_FINAL, current_time)
            message = "终章已开启，未完成的旁枝题已经关闭。"
        elif action == "continue_bonus":
            if phase != PHASE_POST_MAIN_CHOICE:
                raise ValueError("当前已经在旁枝阶段。")
            set_project_phase(con, participant_id, PHASE_BONUS, current_time)
            message = "旁枝题已开放。你仍可随时从页面顶部进入终章。"
        else:
            raise ValueError("未知的选择。")

    return {"ok": True, "message": message, "state": get_project_state(participant_id, db_path)}


def choose_lottery_prize(con):
    inventory = lottery_inventory(con)
    remaining_prizes = []
    for prize in inventory["prizes"]:
        if prize["remaining"] > 0:
            remaining_prizes.extend([prize] * prize["remaining"])
    if not remaining_prizes:
        return {"tier": "waitlist", "label": "额外奖候补"}
    return remaining_prizes[secrets.randbelow(len(remaining_prizes))]


def draw_lottery(participant_id, db_path=DB_PATH, current_time=None):
    current_time = current_time if current_time is not None else now_ts()
    with connect(db_path) as con:
        con.execute("BEGIN IMMEDIATE")
        participant = con.execute("SELECT * FROM participants WHERE public_id = ?", (participant_id,)).fetchone()
        if not participant:
            raise ValueError("参与者不存在，请刷新页面重新进入活动。")

        progress = progress_map(con, participant_id)
        if "Final" not in progress:
            raise ValueError("需要完成终章后才能抽奖。")

        lottery = public_lottery_state(con, participant_id, progress)
        if lottery["chances_total"] <= 0:
            raise ValueError("你还没有额外抽奖机会。")
        if lottery["draws_remaining"] <= 0:
            raise ValueError("抽奖机会已经用完。")

        draw_index = lottery["draws_used"] + 1
        prize = choose_lottery_prize(con)
        con.execute(
            """
            INSERT INTO lottery_draws (participant_id, project_id, draw_index, prize_tier, prize_label, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (participant_id, PROJECT_ID, draw_index, prize["tier"], prize["label"], current_time),
        )
        row = con.execute(
            """
            SELECT * FROM lottery_draws
            WHERE participant_id = ? AND project_id = ? AND draw_index = ?
            """,
            (participant_id, PROJECT_ID, draw_index),
        ).fetchone()

    return {
        "ok": True,
        "message": f"抽中了{row['prize_label']}。",
        "draw": serialize_lottery_draw(row),
        "state": get_project_state(participant_id, db_path),
    }


def admin_login(nickname, password, db_path=DB_PATH):
    nickname = (nickname or "").strip()
    password = (password or "").strip()
    if not nickname:
        raise ValueError("请输入工作人员昵称。")
    failure_key = nickname or "anonymous"
    current_time = now_ts()
    failures = [
        ts
        for ts in ADMIN_LOGIN_FAILURES.get(failure_key, [])
        if current_time - ts < ADMIN_LOGIN_WINDOW_SECONDS
    ]
    if len(failures) >= ADMIN_LOGIN_MAX_FAILURES:
        ADMIN_LOGIN_FAILURES[failure_key] = failures
        raise ValueError("后台密码错误次数较多，请稍后再试。")
    if not ADMIN_PASSWORD:
        raise ValueError("后台密码未配置，请用环境变量 ADMIN_PASSWORD 启动服务后再登录。")
    if password != ADMIN_PASSWORD:
        failures.append(current_time)
        ADMIN_LOGIN_FAILURES[failure_key] = failures
        raise ValueError("后台密码不正确。")
    ADMIN_LOGIN_FAILURES.pop(failure_key, None)
    token = secrets.token_urlsafe(24)
    with connect(db_path) as con:
        con.execute(
            """
            INSERT INTO admin_sessions (token, nickname, staff_name, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (token, nickname, "工作人员", current_time),
        )
    return {"token": token, "nickname": nickname, "staff_name": "工作人员"}


def admin_logout(token, db_path=DB_PATH):
    token = (token or "").strip()
    if not token:
        return {"ok": True}
    with connect(db_path) as con:
        con.execute("DELETE FROM admin_sessions WHERE token = ?", (token,))
    return {"ok": True}


def get_admin_session(token, db_path=DB_PATH):
    token = (token or "").strip()
    if not token:
        return None
    with connect(db_path) as con:
        row = con.execute("SELECT * FROM admin_sessions WHERE token = ?", (token,)).fetchone()
        if row and now_ts() - row["created_at"] > ADMIN_SESSION_TTL_SECONDS:
            con.execute("DELETE FROM admin_sessions WHERE token = ?", (token,))
            return None
        return dict(row) if row else None


def require_admin_session(token, db_path=DB_PATH):
    session = get_admin_session(token, db_path)
    if not session:
        raise PermissionError("请先输入工作人员密码进入后台。")
    return session


def participant_award_details(con, participant_id, progress=None, lottery=None):
    participant = con.execute("SELECT * FROM participants WHERE public_id = ?", (participant_id,)).fetchone()
    if progress is None:
        progress_rows = progress_rows_in_order(con, participant_id)
        completed_ids = [row["question_id"] for row in progress_rows]
    else:
        completed_ids = list(progress.keys())
    main_count = sum(1 for qid in MAIN_IDS if qid in completed_ids)
    bonus_count = sum(1 for qid in BONUS_IDS if qid in completed_ids)
    final_complete = "Final" in completed_ids
    if main_count < len(MAIN_IDS):
        award_level = "暂未达到领奖条件"
    elif final_complete:
        lottery = lottery if lottery is not None else public_lottery_state(con, participant_id)
        award_level = lottery["award_summary"] or BASE_REWARD_LABEL
    else:
        award_level = f"{BASE_REWARD_LABEL}待解锁"
    lottery = lottery if lottery is not None else public_lottery_state(con, participant_id)
    return {
        "participant_id": participant_id,
        "student_id": participant["student_id"] if participant and participant["student_id"] else "",
        "phone": participant["phone"] if participant and participant["phone"] else "",
        "participant_kind": participant["participant_kind"] if participant else "",
        "completed_count": len(completed_ids),
        "completed_ids": completed_ids,
        "main_completed": main_count,
        "bonus_completed": bonus_count,
        "final_complete": final_complete,
        "extra_lottery_chances": bonus_count,
        "lottery_draws_used": lottery["draws_used"],
        "lottery_draws_remaining": lottery["draws_remaining"],
        "lottery_prize_summary": lottery["prize_summary"],
        "award_level": award_level,
    }


def admin_overview(db_path=DB_PATH, admin_session=None):
    with connect(db_path) as con:
        participants = con.execute("SELECT COUNT(*) AS count FROM participants").fetchone()["count"]
        submissions = con.execute("SELECT COUNT(*) AS count FROM submissions WHERE is_rate_limited = 0").fetchone()["count"]
        rate_limited = con.execute("SELECT COUNT(*) AS count FROM submissions WHERE is_rate_limited = 1").fetchone()["count"]
        final_done = con.execute(
            "SELECT COUNT(*) AS count FROM progress WHERE project_id = ? AND question_id = 'Final'",
            (PROJECT_ID,),
        ).fetchone()["count"]
        inventory = lottery_inventory(con)
        base_reserved = 0
        base_redeemed = 0
        reserved_counts = {}
        redeemed_counts = {}
        question_stats = []
        for item in QUESTIONS:
            row = con.execute(
                """
                SELECT
                    SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct,
                    SUM(CASE WHEN is_correct = 0 AND is_rate_limited = 0 THEN 1 ELSE 0 END) AS wrong
                FROM submissions
                WHERE project_id = ? AND question_id = ?
                """,
                (PROJECT_ID, item["id"]),
            ).fetchone()
            completed = con.execute(
                """
                SELECT COUNT(*) AS count FROM progress
                WHERE project_id = ? AND question_id = ?
                """,
                (PROJECT_ID, item["id"]),
            ).fetchone()["count"]
            question_stats.append(
                {
                    "id": item["id"],
                    "title": item["title"],
                    "kind": item["kind"],
                    "completed": completed,
                    "correct_submissions": row["correct"] or 0,
                    "wrong_submissions": row["wrong"] or 0,
                }
            )

        recent_submissions = [
            {
                "participant_id": row["participant_id"],
                "student_id": row["student_id"] or "",
                "question_id": row["question_id"],
                "answer": row["answer"],
                "is_correct": bool(row["is_correct"]),
                "is_rate_limited": bool(row["is_rate_limited"]),
                "message": row["message"],
                "submitted_at": row["submitted_at"],
            }
            for row in con.execute(
                """
                SELECT submissions.*, participants.student_id
                FROM submissions
                LEFT JOIN participants ON participants.public_id = submissions.participant_id
                WHERE submissions.project_id = ?
                ORDER BY submissions.submitted_at DESC
                LIMIT 10
                """,
                (PROJECT_ID,),
            ).fetchall()
        ]

        redeem_codes = []
        reserved_awards = []
        for row in con.execute(
            """
            SELECT redeem_codes.*, participants.student_id
            FROM redeem_codes
            LEFT JOIN participants ON participants.public_id = redeem_codes.participant_id
            WHERE redeem_codes.project_id = ?
            ORDER BY redeem_codes.created_at DESC
            """,
            (PROJECT_ID,),
        ).fetchall():
            progress = progress_map(con, row["participant_id"])
            lottery = public_lottery_state(con, row["participant_id"], progress)
            award = participant_award_details(con, row["participant_id"], progress=progress, lottery=lottery)
            award_finalized = lottery["draws_remaining"] == 0
            final_complete = award["final_complete"]
            cyber_gift_sent = bool(row["cyber_gift_at"])
            if row["redeemed_at"]:
                base_redeemed += 1
                for draw in lottery["draws"]:
                    label = draw["prize_label"]
                    redeemed_counts[label] = redeemed_counts.get(label, 0) + 1
            elif final_complete and not cyber_gift_sent:
                base_reserved += 1
            if not row["redeemed_at"] and not cyber_gift_sent and award_finalized:
                for draw in lottery["draws"]:
                    label = draw["prize_label"]
                    reserved_counts[label] = reserved_counts.get(label, 0) + 1
            redeem_codes.append(
                {
                    "participant_id": row["participant_id"],
                    "student_id": award["student_id"],
                    "phone": award["phone"],
                    "code": row["code"],
                    "created_at": row["created_at"],
                    "redeemed_at": row["redeemed_at"],
                    "redeemed": bool(row["redeemed_at"]),
                    "redeemed_by": row["redeemed_by"] or "",
                    "cyber_gift_at": row["cyber_gift_at"],
                    "cyber_gift_by": row["cyber_gift_by"] or "",
                    "cyber_gift_sent": cyber_gift_sent,
                    "note": row["note"] or "",
                    "award_summary": award["award_level"],
                    "lottery_prize_summary": lottery["prize_summary"],
                    "lottery_draws_remaining": lottery["draws_remaining"],
                    "lottery_draws_used": lottery["draws_used"],
                }
            )
            if not row["redeemed_at"] and final_complete and not cyber_gift_sent:
                reserved_awards.append(
                    {
                        "participant_id": row["participant_id"],
                        "student_id": award["student_id"],
                        "phone": award["phone"],
                        "code": row["code"],
                        "award_summary": award["award_level"],
                        "lottery_draws_remaining": lottery["draws_remaining"],
                        "created_at": row["created_at"],
                    }
                )

        base_counted = base_reserved + base_redeemed
        base_over_reserved = max(0, base_counted - BASE_REWARD_STOCK)
        base_remaining = max(0, BASE_REWARD_STOCK - base_counted)
        prize_fulfillment = [
            {
                "label": BASE_REWARD_LABEL,
                "stock": BASE_REWARD_STOCK,
                "reserved": base_reserved,
                "redeemed": base_redeemed,
                "remaining": f"0（超额 {base_over_reserved}）" if base_over_reserved else base_remaining,
            }
        ]
        for prize in LOTTERY_PRIZES:
            reserved = reserved_counts.get(prize["label"], 0)
            redeemed = redeemed_counts.get(prize["label"], 0)
            prize_fulfillment.append(
                {
                    "label": prize["label"],
                    "stock": prize["stock"],
                    "reserved": reserved,
                    "redeemed": redeemed,
                    "remaining": max(0, prize["stock"] - reserved - redeemed),
                }
            )
        known_prize_labels = {prize["label"] for prize in LOTTERY_PRIZES}
        for label in sorted((set(reserved_counts) | set(redeemed_counts)) - known_prize_labels):
            prize_fulfillment.append(
                {
                    "label": label,
                    "stock": "候补",
                    "reserved": reserved_counts.get(label, 0),
                    "redeemed": redeemed_counts.get(label, 0),
                    "remaining": "候补",
                }
            )

    return {
        "project": PROJECT,
        "admin": {
            "nickname": admin_session["nickname"] if admin_session else "",
            "staff_name": admin_session["staff_name"] if admin_session else "",
        },
        "participants": participants,
        "submissions": submissions,
        "rate_limited": rate_limited,
        "final_done": final_done,
        "lottery_drawn": inventory["drawn"],
        "lottery_remaining": inventory["remaining"],
        "lottery_inventory": inventory,
        "prize_fulfillment": prize_fulfillment,
        "reserved_awards": reserved_awards,
        "question_stats": question_stats,
        "recent_submissions": recent_submissions,
        "redeem_codes": redeem_codes,
    }


def admin_submissions(db_path=DB_PATH, admin_session=None):
    with connect(db_path) as con:
        rows = [
            {
                "participant_id": row["participant_id"],
                "student_id": row["student_id"] or "",
                "question_id": row["question_id"],
                "answer": row["answer"],
                "is_correct": bool(row["is_correct"]),
                "is_rate_limited": bool(row["is_rate_limited"]),
                "message": row["message"],
                "submitted_at": row["submitted_at"],
            }
            for row in con.execute(
                """
                SELECT submissions.*, participants.student_id
                FROM submissions
                LEFT JOIN participants ON participants.public_id = submissions.participant_id
                WHERE submissions.project_id = ?
                ORDER BY submissions.submitted_at DESC
                """,
                (PROJECT_ID,),
            ).fetchall()
        ]
    return {
        "project": PROJECT,
        "admin": {
            "nickname": admin_session["nickname"] if admin_session else "",
            "staff_name": admin_session["staff_name"] if admin_session else "",
        },
        "submissions": rows,
    }


def redeem_code(code, redeemed_by="", note="", db_path=DB_PATH):
    code = (code or "").strip().upper()
    if not code:
        raise ValueError("请输入兑奖码。")
    current_time = now_ts()
    with connect(db_path) as con:
        con.execute("BEGIN IMMEDIATE")
        row = con.execute("SELECT * FROM redeem_codes WHERE code = ?", (code,)).fetchone()
        if not row:
            return {"ok": False, "message": "没有找到这个兑奖码。"}
        progress = progress_map(con, row["participant_id"])
        lottery = public_lottery_state(con, row["participant_id"], progress)
        details = participant_award_details(con, row["participant_id"], progress=progress, lottery=lottery)
        if row["redeemed_at"]:
            return {
                "ok": False,
                "message": "该参与者此前已核销",
                "redeem": serialize_redeem(row, award=details, lottery=lottery),
                "award": details,
            }
        if row["cyber_gift_at"]:
            return {
                "ok": False,
                "message": "该参与者已发送赛博礼物，如需改发实体礼物请先撤销核销。",
                "redeem": serialize_redeem(row, award=details, lottery=lottery),
                "award": details,
            }
        if details["lottery_draws_remaining"] > 0:
            return {
                "ok": False,
                "message": f"还有 {details['lottery_draws_remaining']} 次抽奖机会未使用，请先让玩家完成网页抽奖。",
                "redeem": serialize_redeem(row, award=details, lottery=lottery),
                "award": details,
            }
        result = con.execute(
            """
            UPDATE redeem_codes
            SET redeemed_at = ?, redeemed_by = ?, note = ?
            WHERE code = ? AND redeemed_at IS NULL
            """,
            (current_time, redeemed_by or None, (note or "").strip() or None, code),
        )
        if result.rowcount != 1:
            row = con.execute("SELECT * FROM redeem_codes WHERE code = ?", (code,)).fetchone()
            return {
                "ok": False,
                "message": "该参与者此前已核销",
                "redeem": serialize_redeem(row, award=details, lottery=lottery),
                "award": details,
            }
        row = con.execute("SELECT * FROM redeem_codes WHERE code = ?", (code,)).fetchone()
        return {
            "ok": True,
            "message": "核销成功。",
            "redeem": serialize_redeem(row, award=details, lottery=lottery),
            "award": details,
        }


def preview_redeem_code(code, db_path=DB_PATH):
    code = (code or "").strip().upper()
    if not code:
        raise ValueError("请输入兑奖码。")
    with connect(db_path) as con:
        row = con.execute("SELECT * FROM redeem_codes WHERE code = ?", (code,)).fetchone()
        if not row:
            return {"ok": False, "message": "没有找到这个兑奖码。"}
        progress = progress_map(con, row["participant_id"])
        lottery = public_lottery_state(con, row["participant_id"], progress)
        details = participant_award_details(con, row["participant_id"], progress=progress, lottery=lottery)
        if details["lottery_draws_remaining"] > 0:
            return {
                "ok": False,
                "message": f"还有 {details['lottery_draws_remaining']} 次抽奖机会未使用，请先让玩家完成网页抽奖。",
                "redeem": serialize_redeem(row, award=details, lottery=lottery),
                "award": details,
            }
        if row["redeemed_at"] or row["cyber_gift_at"]:
            return {
                "ok": False,
                "message": "该参与者已核销，礼物已发送。",
                "redeem": serialize_redeem(row, award=details, lottery=lottery),
                "award": details,
            }
        return {
            "ok": True,
            "message": "请核验该参与者是否为 26 届毕业生。",
            "redeem": serialize_redeem(row, award=details, lottery=lottery),
            "award": details,
            "needs_eligibility_check": True,
        }


def send_cyber_gift(code, sent_by="", db_path=DB_PATH):
    code = (code or "").strip().upper()
    if not code:
        raise ValueError("请输入兑奖码。")
    current_time = now_ts()
    with connect(db_path) as con:
        con.execute("BEGIN IMMEDIATE")
        row = con.execute("SELECT * FROM redeem_codes WHERE code = ?", (code,)).fetchone()
        if not row:
            return {"ok": False, "message": "没有找到这个兑奖码。"}
        progress = progress_map(con, row["participant_id"])
        lottery = public_lottery_state(con, row["participant_id"], progress)
        details = participant_award_details(con, row["participant_id"], progress=progress, lottery=lottery)
        if row["redeemed_at"]:
            return {
                "ok": False,
                "message": "该参与者此前已核销",
                "redeem": serialize_redeem(row, award=details, lottery=lottery),
                "award": details,
            }
        if not row["cyber_gift_at"]:
            con.execute(
                """
                UPDATE redeem_codes
                SET cyber_gift_at = ?, cyber_gift_by = ?
                WHERE code = ?
                """,
                (current_time, sent_by or None, code),
            )
            create_participant_event(
                con,
                row["participant_id"],
                "cyber_gift",
                {
                    "title": "赛博礼物已送达",
                    "message": "谢谢你一起完成这趟楼里的旅程。愿今晚的歌声，也能带给你前程似锦的祝福",
                },
                current_time,
            )
        row = con.execute("SELECT * FROM redeem_codes WHERE code = ?", (code,)).fetchone()
        return {
            "ok": True,
            "message": "已发送赛博礼物。",
            "redeem": serialize_redeem(row, award=details, lottery=lottery),
            "award": details,
        }


def unredeem_code(code, db_path=DB_PATH):
    code = (code or "").strip().upper()
    if not code:
        raise ValueError("请输入兑奖码。")
    with connect(db_path) as con:
        row = con.execute("SELECT * FROM redeem_codes WHERE code = ?", (code,)).fetchone()
        if not row:
            return {"ok": False, "message": "没有找到这个兑奖码。"}
        progress = progress_map(con, row["participant_id"])
        lottery = public_lottery_state(con, row["participant_id"], progress)
        details = participant_award_details(con, row["participant_id"], progress=progress, lottery=lottery)
        if not row["redeemed_at"] and not row["cyber_gift_at"]:
            return {
                "ok": False,
                "message": "该兑奖码当前未核销。",
                "redeem": serialize_redeem(row, award=details, lottery=lottery),
                "award": details,
            }
        con.execute(
            """
            UPDATE redeem_codes
            SET redeemed_at = NULL, redeemed_by = NULL, note = NULL,
                cyber_gift_at = NULL, cyber_gift_by = NULL
            WHERE code = ?
            """,
            (code,),
        )
        row = con.execute("SELECT * FROM redeem_codes WHERE code = ?", (code,)).fetchone()
        return {
            "ok": True,
            "message": "已撤销核销，可重新核销并发放礼物。",
            "redeem": serialize_redeem(row, award=details, lottery=lottery),
            "award": details,
        }


class OrientationHandler(BaseHTTPRequestHandler):
    server_version = "OrientationPuzzle/1.0"

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}")

    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            path = parsed.path
            if path in {"/", "/project/shexi-graduation", "/admin", "/admin/submissions"}:
                return self.serve_file(STATIC_DIR / "index.html")
            if path.startswith("/static/"):
                rel = path.removeprefix("/static/")
                return self.serve_static(rel)
            if path == "/api/admin/overview":
                admin_session = require_admin_session(self.admin_token())
                return self.send_json(200, admin_overview(admin_session=admin_session))
            if path == "/api/admin/submissions":
                admin_session = require_admin_session(self.admin_token())
                return self.send_json(200, admin_submissions(admin_session=admin_session))
            if path == f"/api/projects/{PROJECT_ID}/state":
                participant_id = parse_qs(parsed.query).get("participant_id", [""])[0]
                if not participant_id:
                    return self.send_json(400, {"error": "缺少参与者编号。"})
                return self.send_json(200, get_project_state(participant_id))
            if path == f"/api/projects/{PROJECT_ID}/events":
                participant_id = parse_qs(parsed.query).get("participant_id", [""])[0]
                if not participant_id:
                    return self.send_json(400, {"error": "缺少参与者编号。"})
                return self.send_json(200, pending_participant_events(participant_id))
            return self.send_json(404, {"error": "Not found"})
        except PermissionError as exc:
            return self.send_json(401, {"error": str(exc)})
        except ValueError as exc:
            return self.send_json(400, {"error": str(exc)})
        except sqlite3.OperationalError as exc:
            print(f"数据库暂时繁忙：{exc}")
            return self.send_json(503, {"error": "服务器正忙，请稍后重试。"})
        except Exception as exc:
            print(f"未预期错误：{exc}")
            return self.send_json(500, {"error": "服务器暂时遇到问题，请重试或联系工作人员。"})

    def do_POST(self):
        try:
            parsed = urlparse(self.path)
            body = self.read_json()
            if parsed.path == "/api/participants":
                return self.send_json(200, create_or_restore_participant(body))
            if parsed.path == "/api/admin/login":
                return self.send_json(200, admin_login(body.get("nickname"), body.get("password")))
            if parsed.path == "/api/admin/logout":
                return self.send_json(200, admin_logout(self.admin_token()))
            if parsed.path == f"/api/projects/{PROJECT_ID}/submit":
                result = submit_answer(
                    body.get("participant_id") or body.get("participantId"),
                    body.get("question_id") or body.get("questionId"),
                    body.get("answer") or "",
                )
                return self.send_json(200, result)
            if parsed.path == f"/api/projects/{PROJECT_ID}/decision":
                result = make_project_decision(
                    body.get("participant_id") or body.get("participantId"),
                    body.get("action") or "",
                )
                return self.send_json(200, result)
            if parsed.path == f"/api/projects/{PROJECT_ID}/lottery/draw":
                result = draw_lottery(body.get("participant_id") or body.get("participantId"))
                return self.send_json(200, result)
            if parsed.path == f"/api/projects/{PROJECT_ID}/events/consume":
                result = consume_participant_event(
                    body.get("participant_id") or body.get("participantId"),
                    body.get("event_id") or body.get("eventId"),
                )
                return self.send_json(200, result)
            if parsed.path == "/api/admin/redeem/preview":
                require_admin_session(self.admin_token())
                result = preview_redeem_code(body.get("code"))
                return self.send_json(200, result)
            if parsed.path == "/api/admin/redeem":
                admin_session = require_admin_session(self.admin_token())
                if not body.get("graduate_confirmed") and not body.get("graduateConfirmed"):
                    raise ValueError("请先确认该参与者为 26 届毕业生。")
                result = redeem_code(body.get("code"), admin_session["nickname"])
                return self.send_json(200, result)
            if parsed.path == "/api/admin/cyber-gift":
                admin_session = require_admin_session(self.admin_token())
                result = send_cyber_gift(body.get("code"), admin_session["nickname"])
                return self.send_json(200, result)
            if parsed.path == "/api/admin/unredeem":
                require_admin_session(self.admin_token())
                result = unredeem_code(body.get("code"))
                return self.send_json(200, result)
            return self.send_json(404, {"error": "Not found"})
        except PermissionError as exc:
            return self.send_json(401, {"error": str(exc)})
        except ValueError as exc:
            return self.send_json(400, {"error": str(exc)})
        except sqlite3.OperationalError as exc:
            print(f"数据库暂时繁忙：{exc}")
            return self.send_json(503, {"error": "服务器正忙，请稍后重试。"})
        except sqlite3.IntegrityError as exc:
            print(f"数据写入冲突：{exc}")
            return self.send_json(409, {"error": "这次操作和已有记录冲突，请刷新后重试。"})
        except Exception as exc:
            print(f"未预期错误：{exc}")
            return self.send_json(500, {"error": "服务器暂时遇到问题，请重试或联系工作人员。"})

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length > MAX_JSON_BODY_BYTES:
            raise ValueError("请求内容过大。")
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            raise ValueError("请求格式不是有效 JSON。")

    def admin_token(self):
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            return auth.removeprefix("Bearer ").strip()
        return self.headers.get("X-Admin-Token", "").strip()

    def send_json(self, status, data):
        encoded = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def serve_static(self, rel):
        target = (STATIC_DIR / rel).resolve()
        if not target.is_relative_to(STATIC_DIR.resolve()):
            return self.send_json(403, {"error": "Forbidden"})
        return self.serve_file(target)

    def serve_file(self, target, content_type=None):
        target = Path(target)
        if not target.exists() or not target.is_file():
            return self.send_json(404, {"error": "File not found"})
        content_type = content_type or mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if target.suffix in {".html", ".js", ".css"}:
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def local_ip_hint():
    for interface in ("en0", "en1"):
        try:
            output = subprocess.check_output(
                ["ipconfig", "getifaddr", interface],
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=1,
            ).strip()
            if output:
                return output
        except (OSError, subprocess.SubprocessError):
            pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def main():
    init_db()
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), OrientationHandler)
    print("社系毕业晚会解密网站已启动")
    print(f"本机访问: http://127.0.0.1:{port}")
    print(f"局域网访问: http://{local_ip_hint()}:{port}")
    print("按 Ctrl+C 停止服务")
    server.serve_forever()


if __name__ == "__main__":
    main()
