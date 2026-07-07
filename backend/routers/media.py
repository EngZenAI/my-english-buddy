from fastapi import APIRouter, HTTPException
from starlette.concurrency import run_in_threadpool

from backend.exceptions import HTTP_JSON_ERRORS
from backend.media_transcript import (
    MediaTranscriptError,
    extract_video_id,
    fetch_media_transcript,
    parse_transcript_text,
)
from backend.schemas.media import MediaTranscriptIn, TranscriptParseIn

router = APIRouter(tags=["media"])


@router.post(
    "/media/transcript",
    summary="미디어 자막 가져오기",
    description="영상 링크에서 공개 자막을 찾아 타임스탬프 스크립트로 반환합니다. 비공식 추출이라 영상에 따라 실패할 수 있습니다.",
)
async def media_transcript(payload: MediaTranscriptIn):
    try:
        return await run_in_threadpool(
            fetch_media_transcript,
            payload.url,
            payload.language or "en",
        )
    except MediaTranscriptError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except HTTP_JSON_ERRORS as exc:
        raise HTTPException(
            status_code=502,
            detail="미디어 자막을 가져오지 못했습니다. 자막 붙여넣기를 사용해주세요.",
        ) from exc


@router.post(
    "/media/transcript/parse",
    summary="붙여넣은 자막 파싱",
    description="SRT, VTT, 타임스탬프가 있는 텍스트를 리딩용 스크립트 세그먼트로 변환합니다.",
)
async def media_transcript_parse(payload: TranscriptParseIn):
    segments = parse_transcript_text(payload.text)
    if not segments:
        raise HTTPException(status_code=422, detail="스크립트에서 읽을 문장을 찾지 못했습니다.")
    video_id = ""
    try:
        video_id = extract_video_id(payload.title)
    except MediaTranscriptError:
        video_id = ""
    return {
        "video_id": video_id,
        "title": payload.title.strip() or "붙여넣은 스크립트",
        "language": "",
        "track_name": "",
        "source": "pasted-transcript",
        "segments": segments,
    }
