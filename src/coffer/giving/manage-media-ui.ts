import {box,field,select} from '../ui/common'
import type {Row} from '../db'

export function campaignImageFields(){
 return `<fieldset><legend>Campaign image (optional)</legend><p>Images are public to everyone viewing the campaign. Coffer removes embedded image metadata. Check the visible image for private details. PNG, JPEG or WebP, up to 1 MiB.</p>${field('Campaign image','image','file','','accept="image/png,image/jpeg,image/webp"')}${field('Image description','imageDescription','text','','maxlength="300"')}<label><input type="checkbox" name="publicMedia" value="yes"> These uploads and their metadata may be published to everyone.</label></fieldset>`
}
export function campaignVideoForm(campaigns:Row[]){
 if(!campaigns.length)return ''
 return box('Campaign video',`<p>Publish a campaign above, then upload its MP4 here. Videos are kept in this installation’s file storage and played on its campaign page. Maximum 100 MiB. Video content and embedded metadata are public; check both for private details before uploading.</p><form data-campaign-video>${select('Campaign for video','campaignId',campaigns.map(c=>[c.id,c.name]))}${field('Campaign video','video','file','','required accept="video/mp4"')}${field('Video description','videoDescription','text','','required maxlength="300"')}<label><input type="checkbox" name="publicMedia" value="yes" required> This video and its metadata may be published to everyone.</label><button>Upload campaign video</button><p data-video-status role="status" aria-live="polite"></p></form><noscript>Enable JavaScript in this browser to stream a video upload.</noscript>`,'campaign-video')
}
